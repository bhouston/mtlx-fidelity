import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants as fsConstants, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type GenerateImageResult,
  type RendererCategory,
  type RendererContext,
  type RendererPrerequisiteCheckResult,
  type RendererStartOptions,
} from '@material-fidelity/core';
import type { RenderLogEntry } from '@material-fidelity/samples';

const BLENDER_EXECUTABLE_ENV = 'BLENDER_EXECUTABLE';
const BLENDER_NODES_EXECUTABLE_ENV = 'BLENDER_NODES_EXECUTABLE';
const MACOS_APPLICATIONS_DIRECTORY = '/Applications';
const BLENDER_PROCESS_TERMINATION_GRACE_MS = 1000;
const BLENDER_MATERIALX_IMPORTER_REQUIRED_FILES = [
  ['blender-materialx-importer', 'materialx_importer', '__init__.py'],
  ['blender-materialx-importer', 'materialx_importer', 'importer.py'],
];
const MX_NOISE_NODE_TYPES = [
  'ShaderNodeMxNoise2D',
  'ShaderNodeMxNoise3D',
  'ShaderNodeMxFractal2D',
  'ShaderNodeMxFractal3D',
  'ShaderNodeMxCellNoise2D',
  'ShaderNodeMxCellNoise3D',
  'ShaderNodeMxWorleyNoise2D',
  'ShaderNodeMxWorleyNoise3D',
  'ShaderNodeMxUnifiedNoise2D',
  'ShaderNodeMxUnifiedNoise3D',
];
const MX_TEXTURE_NODE_TYPES = ['ShaderNodeMxHextiledImage'];
const MX_CUSTOM_NODE_TYPES = [...MX_NOISE_NODE_TYPES, ...MX_TEXTURE_NODE_TYPES];

interface BlenderVersion {
  major: number;
  minor: number;
  patch: number;
}

interface BlenderRendererOptions {
  name: string;
  category: RendererCategory;
  scriptFileName: string;
  renderEngine: string;
  minimumBlenderVersion: BlenderVersion;
  requiredSubmoduleFiles?: string[][];
  runtimePythonExpression?: (submodulesRoot: string) => string;
  executableCandidates?: (packageRoot: string) => string[];
  executableNotFoundMessage?: (candidates: string[]) => string;
}

const BLENDER_RENDERER_OPTIONS: BlenderRendererOptions = {
  name: 'blender-new',
  category: 'pathtracer',
  scriptFileName: 'render_materialx.py',
  renderEngine: 'CYCLES',
  minimumBlenderVersion: { major: 4, minor: 0, patch: 0 },
  requiredSubmoduleFiles: BLENDER_MATERIALX_IMPORTER_REQUIRED_FILES,
};

function createBlenderNodesExecutableCandidates(packageRoot: string): string[] {
  return [
    ...optionalEnvCandidate(BLENDER_NODES_EXECUTABLE_ENV),
    join(packageRoot, '..', '..', 'build', 'blender', 'bin', 'Blender.app', 'Contents', 'MacOS', 'Blender'),
    'blender',
  ];
}

function createBlenderNodesExecutableNotFoundMessage(rendererName: string, candidates: string[]): string {
  return `Unable to locate patched Blender executable for ${rendererName}. Set ${BLENDER_NODES_EXECUTABLE_ENV} or build the local Blender checkout. Tried: ${candidates.join(', ')}.`;
}

const BLENDER_NODES_RENDERER_OPTIONS: BlenderRendererOptions = {
  name: 'blender-nodes',
  category: 'pathtracer',
  scriptFileName: 'render_materialx.py',
  renderEngine: 'CYCLES',
  minimumBlenderVersion: { major: 4, minor: 0, patch: 0 },
  requiredSubmoduleFiles: BLENDER_MATERIALX_IMPORTER_REQUIRED_FILES,
  executableCandidates: createBlenderNodesExecutableCandidates,
  executableNotFoundMessage: (candidates) => createBlenderNodesExecutableNotFoundMessage('blender-nodes', candidates),
  runtimePythonExpression: () => createMxCustomNodeProbeExpression(),
};

const BLENDER_EEVEE_NODES_RENDERER_OPTIONS: BlenderRendererOptions = {
  ...BLENDER_NODES_RENDERER_OPTIONS,
  name: 'blender-eevee-nodes',
  category: 'rasterizer',
  renderEngine: 'BLENDER_EEVEE',
  executableNotFoundMessage: (candidates) =>
    createBlenderNodesExecutableNotFoundMessage('blender-eevee-nodes', candidates),
};

function isExecutablePath(candidate: string): boolean {
  if (!candidate.includes('/') && !candidate.includes('\\')) {
    return true;
  }

  try {
    return existsSync(candidate);
  } catch {
    return false;
  }
}

function optionalEnvCandidate(name: string): string[] {
  const value = process.env[name]?.trim();
  return value ? [value] : [];
}

function commandExists(command: string): boolean {
  if (!isExecutablePath(command)) {
    return false;
  }

  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 5000,
    shell: false,
  });

  return !result.error && result.status === 0;
}

function parseBlenderAppVersion(appName: string): number[] {
  const match = appName.match(/^Blender(?:\s+(.+))?\.app$/);
  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}

function compareVersionPartsDescending(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart !== rightPart) {
      return rightPart - leftPart;
    }
  }
  return 0;
}

function discoverMacOSBlenderExecutables(): string[] {
  let entries;
  try {
    entries = readdirSync(MACOS_APPLICATIONS_DIRECTORY, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && /^Blender(?:\s+.*)?\.app$/.test(entry.name))
    .toSorted((left, right) => {
      if (left.name === 'Blender.app') {
        return -1;
      }
      if (right.name === 'Blender.app') {
        return 1;
      }
      return compareVersionPartsDescending(parseBlenderAppVersion(left.name), parseBlenderAppVersion(right.name));
    })
    .map((entry) => join(MACOS_APPLICATIONS_DIRECTORY, entry.name, 'Contents', 'MacOS', 'Blender'));
}

function resolveExecutable(options?: BlenderRendererOptions, packageRoot?: string): string {
  const configuredExecutable = process.env[BLENDER_EXECUTABLE_ENV]?.trim();
  const discoveredExecutables = discoverMacOSBlenderExecutables();
  const defaultCandidates = options?.executableCandidates?.(packageRoot ?? '') ?? ['blender', ...discoveredExecutables];
  const candidates = options?.executableCandidates
    ? defaultCandidates
    : configuredExecutable
      ? [configuredExecutable, ...defaultCandidates]
      : defaultCandidates;
  const match = candidates.find((candidate) => commandExists(candidate));
  if (!match) {
    if (options?.executableNotFoundMessage) {
      throw new Error(options.executableNotFoundMessage(candidates));
    }
    throw new Error(
      `Unable to locate Blender executable. Set ${BLENDER_EXECUTABLE_ENV} or add blender to PATH. Tried: ${candidates.join(', ')}.`,
    );
  }

  return match;
}

function createMxCustomNodeProbeExpression(): string {
  return [
    'import bpy',
    `ids = ${JSON.stringify(MX_CUSTOM_NODE_TYPES)}`,
    'mat = bpy.data.materials.new("mx_probe")',
    'mat.use_nodes = True',
    'nodes = mat.node_tree.nodes',
    'missing = []',
    'for node_id in ids:',
    '    try:',
    '        probe = nodes.new(type=node_id)',
    '        nodes.remove(probe)',
    '    except Exception:',
    '        missing.append(node_id)',
    'if missing:',
    '    raise RuntimeError("Missing MaterialX custom Blender nodes: " + ", ".join(missing))',
    'print("MATERIALX_CUSTOM_NODES=available")',
  ].join('\n');
}

function parseBlenderVersion(output: string): BlenderVersion | undefined {
  const match = output.match(/Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
  };
}

function formatBlenderVersion(version: BlenderVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function isSupportedBlenderVersion(version: BlenderVersion, minimumVersion: BlenderVersion): boolean {
  if (version.major !== minimumVersion.major) {
    return version.major > minimumVersion.major;
  }
  if (version.minor !== minimumVersion.minor) {
    return version.minor > minimumVersion.minor;
  }
  return version.patch >= minimumVersion.patch;
}

function createRenderError(message: string, logs: RenderLogEntry[]): Error & { rendererLogs: RenderLogEntry[] } {
  const error = new Error(message) as Error & { rendererLogs: RenderLogEntry[] };
  error.rendererLogs = logs;
  return error;
}

function collectOutputLines(value: string, level: RenderLogEntry['level']): RenderLogEntry[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((message) => shouldIncludeRendererLogMessage(message))
    .map((message) => ({ level: classifyRendererLogLevel(message, level), source: 'renderer', message }));
}

function shouldIncludeRendererLogMessage(message: string): boolean {
  const event = parseRendererJsonEvent(message);
  return !(
    /^\d{2}:\d{2}\.\d{3}\s+blend\s+\|\s+Read blend:/.test(message) ||
    /^\d{2}:\d{2}\.\d{3}\s+render\s+\|\s+Saved:/.test(message) ||
    (typeof event?.event === 'string' &&
      (event.event.endsWith('-render-start') ||
        event.event.endsWith('-render-timing') ||
        event.event.endsWith('-render-finish')))
  );
}

function classifyRendererLogLevel(message: string, fallback: RenderLogEntry['level']): RenderLogEntry['level'] {
  const event = parseRendererJsonEvent(message);
  if (event && typeof event.event === 'string' && event.event.endsWith('-render-import-failed')) {
    return 'error';
  }
  return fallback;
}

function parseRendererJsonEvent(message: string): Record<string, unknown> | undefined {
  if (!message.startsWith('{')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(message);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function summarizeBlenderFailure(logs: RenderLogEntry[], code: number | null): string {
  for (const entry of logs.toReversed()) {
    const event = parseRendererJsonEvent(entry.message);
    if (event && typeof event.event === 'string' && event.event.endsWith('-render-import-failed')) {
      return typeof event.error === 'string' ? event.error : 'Blender MaterialX import failed.';
    }
  }

  const meaningfulFailure = logs
    .toReversed()
    .find(
      (entry) =>
        entry.message !== 'Blender quit' &&
        (entry.level === 'error' ||
          entry.level === 'warning' ||
          /\bERROR\b|Error:|Traceback \(most recent call last\)/.test(entry.message)),
    );
  if (meaningfulFailure) {
    return meaningfulFailure.message;
  }

  const lastNonQuitMessage = logs.toReversed().find((entry) => entry.message !== 'Blender quit')?.message;
  return lastNonQuitMessage ?? `Blender exited with code ${String(code)}.`;
}

function killBlenderProcessGroup(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === 'win32' || typeof processHandle.pid !== 'number') {
    return;
  }

  try {
    process.kill(-processHandle.pid, signal);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ESRCH') {
      throw error;
    }
  }
}

function scheduleBlenderProcessGroupCleanup(processHandle: ChildProcess): void {
  try {
    killBlenderProcessGroup(processHandle, 'SIGTERM');
  } catch {
    return;
  }

  setTimeout(() => {
    try {
      killBlenderProcessGroup(processHandle, 'SIGKILL');
    } catch {
      // Best-effort cleanup for leaked Blender descendants.
    }
  }, BLENDER_PROCESS_TERMINATION_GRACE_MS).unref();
}

async function stopActiveBlenderProcesses(activeProcesses: Set<ChildProcess>): Promise<void> {
  if (activeProcesses.size === 0) {
    return;
  }

  for (const processHandle of activeProcesses) {
    try {
      killBlenderProcessGroup(processHandle, 'SIGTERM');
    } catch {
      // Continue cleanup for the remaining Blender process groups.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, BLENDER_PROCESS_TERMINATION_GRACE_MS));

  for (const processHandle of activeProcesses) {
    try {
      killBlenderProcessGroup(processHandle, 'SIGKILL');
    } catch {
      // The process group may already be gone.
    }
  }
}

function checkBlenderPythonExpression(
  executable: string,
  expression: string,
  unavailableMessage: string,
): RendererPrerequisiteCheckResult {
  const result = spawnSync(executable, ['--background', '--factory-startup', '--python-expr', expression], {
    encoding: 'utf8',
    timeout: 15000,
    shell: false,
  });
  if (result.error) {
    return { success: false, message: result.error.message };
  }
  if (result.status !== 0) {
    const logs = [...collectOutputLines(result.stdout, 'info'), ...collectOutputLines(result.stderr, 'warning')];
    const detail = summarizeBlenderFailure(logs, result.status);
    return { success: false, message: `${unavailableMessage}: ${detail}` };
  }

  return { success: true };
}

function checkBlenderRuntime(
  executable: string,
  minimumVersion: BlenderVersion,
  runtimePythonExpression?: string,
): RendererPrerequisiteCheckResult {
  const versionResult = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    shell: false,
  });
  if (versionResult.error) {
    return { success: false, message: versionResult.error.message };
  }
  if (versionResult.status !== 0) {
    return { success: false, message: `Blender --version exited with code ${String(versionResult.status)}.` };
  }

  const version = parseBlenderVersion(versionResult.stdout);
  if (!version) {
    return { success: false, message: `Unable to parse Blender version from: ${versionResult.stdout.trim()}` };
  }
  if (!isSupportedBlenderVersion(version, minimumVersion)) {
    return {
      success: false,
      message: `Blender ${formatBlenderVersion(version)} is not supported. Blender ${formatBlenderVersion(minimumVersion)}+ is required.`,
    };
  }

  const materialXCheck = checkBlenderPythonExpression(
    executable,
    'import MaterialX as mx; print("MATERIALX_VERSION=" + mx.getVersionString())',
    'Blender bundled MaterialX module is unavailable',
  );
  if (!materialXCheck.success) {
    return materialXCheck;
  }

  if (runtimePythonExpression) {
    const rendererCheck = checkBlenderPythonExpression(
      executable,
      runtimePythonExpression,
      'Blender renderer runtime is unavailable',
    );
    if (!rendererCheck.success) {
      return rendererCheck;
    }
  }

  return { success: true };
}

function execute(executable: string, args: string[], activeProcesses: Set<ChildProcess>): Promise<RenderLogEntry[]> {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(executable, args, {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs: RenderLogEntry[] = [];
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;

    activeProcesses.add(processHandle);

    const flushBufferedLines = (buffer: string, level: RenderLogEntry['level']): string => {
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() ?? '';
      for (const line of lines) {
        const message = line.trim();
        if (!message) {
          continue;
        }
        if (!shouldIncludeRendererLogMessage(message)) {
          continue;
        }
        logs.push({ level: classifyRendererLogLevel(message, level), source: 'renderer', message });
      }
      return remainder;
    };

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      activeProcesses.delete(processHandle);
      processHandle.stdout.removeAllListeners();
      processHandle.stderr.removeAllListeners();
      processHandle.removeAllListeners();
      scheduleBlenderProcessGroupCleanup(processHandle);
      callback();
    };

    processHandle.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      stdoutBuffer = flushBufferedLines(stdoutBuffer, 'info');
    });
    processHandle.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      stderrBuffer = flushBufferedLines(stderrBuffer, 'warning');
    });

    processHandle.on('error', (error) => {
      settle(() => reject(createRenderError(error.message, logs)));
    });

    processHandle.on('close', (code) => {
      stdoutBuffer = flushBufferedLines(`${stdoutBuffer}\n`, 'info');
      stderrBuffer = flushBufferedLines(`${stderrBuffer}\n`, 'warning');

      if (code === 0) {
        settle(() => resolve(logs));
        return;
      }

      const message = summarizeBlenderFailure(logs, code);
      settle(() => reject(createRenderError(message, logs)));
    });
  });
}

class BlenderRenderer implements FidelityRenderer {
  public readonly name: string;
  public readonly version = '0.1.0';
  public readonly category: RendererCategory;
  public readonly emptyReferenceImagePath: string;
  private readonly options: BlenderRendererOptions;
  private readonly packageRoot: string;
  private readonly submodulesRoot: string;
  private executable: string | undefined;
  private prerequisitesValidated = false;
  private templateDirectory: string | undefined;
  private templatePath: string | undefined;
  private startOptions: RendererStartOptions | undefined;
  private readonly activeProcesses = new Set<ChildProcess>();

  public constructor(context: RendererContext, options: BlenderRendererOptions) {
    this.name = options.name;
    this.category = options.category;
    this.options = options;
    this.submodulesRoot = context.submodulesRoot;
    this.packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    this.emptyReferenceImagePath = join(this.packageRoot, 'blender-empty.png');
  }

  private get scriptPath(): string {
    return join(this.packageRoot, 'blender', this.options.scriptFileName);
  }

  public async checkPrerequisites(): Promise<RendererPrerequisiteCheckResult> {
    if (this.prerequisitesValidated && this.executable) {
      return { success: true };
    }

    try {
      const executable = resolveExecutable(this.options, this.packageRoot);
      const scriptPath = this.scriptPath;
      const missingFiles: string[] = [];
      const requiredFiles = [
        scriptPath,
        ...(this.options.requiredSubmoduleFiles ?? []).map((parts) => join(this.submodulesRoot, ...parts)),
      ];
      for (const filePath of requiredFiles) {
        try {
          await access(filePath, fsConstants.R_OK);
        } catch {
          missingFiles.push(filePath);
        }
      }
      if (missingFiles.length > 0) {
        return { success: false, message: `Missing required renderer files: ${missingFiles.join(', ')}` };
      }

      const runtimeCheck = checkBlenderRuntime(
        executable,
        this.options.minimumBlenderVersion,
        this.options.runtimePythonExpression?.(this.submodulesRoot),
      );
      if (!runtimeCheck.success) {
        this.prerequisitesValidated = false;
        return runtimeCheck;
      }

      this.executable = executable;
      this.prerequisitesValidated = true;
      return { success: true };
    } catch (error) {
      this.prerequisitesValidated = false;
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  public async start(options: RendererStartOptions): Promise<void> {
    if (this.executable && this.prerequisitesValidated && this.templatePath) {
      return;
    }

    const checkResult = await this.checkPrerequisites();
    if (!checkResult.success) {
      throw new Error(checkResult.message ?? `${this.name} prerequisites are not satisfied.`);
    }

    if (!this.executable) {
      throw new Error('Blender executable was not resolved during prerequisite validation.');
    }

    const scriptPath = this.scriptPath;
    const templateDirectory = await mkdtemp(join(tmpdir(), 'material-fidelity-blender-'));
    const templatePath = join(templateDirectory, 'template.blend');
    const args = [
      '--background',
      '--factory-startup',
      '--python',
      scriptPath,
      '--',
      '--template-output-path',
      templatePath,
      '--model-path',
      options.modelPath,
      '--environment-hdr-path',
      options.environmentHdrPath,
      '--background-color',
      options.backgroundColor,
      '--width',
      String(REFERENCE_IMAGE_WIDTH),
      '--height',
      String(REFERENCE_IMAGE_HEIGHT),
      '--submodules-root',
      this.submodulesRoot,
      '--renderer-name',
      this.name,
      '--render-engine',
      this.options.renderEngine,
    ];

    try {
      const logs = await execute(this.executable, args, this.activeProcesses);
      try {
        await access(templatePath, fsConstants.R_OK);
      } catch {
        throw createRenderError(`Blender template was not created: ${templatePath}`, logs);
      }
      this.templateDirectory = templateDirectory;
      this.templatePath = templatePath;
      this.startOptions = options;
    } catch (error) {
      await rm(templateDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    const templateDirectory = this.templateDirectory;
    this.templateDirectory = undefined;
    this.templatePath = undefined;
    this.startOptions = undefined;
    await stopActiveBlenderProcesses(this.activeProcesses);
    if (templateDirectory) {
      await rm(templateDirectory, { recursive: true, force: true });
    }
  }

  public async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!this.executable || !this.templatePath || !this.startOptions) {
      throw new Error('Renderer has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const scriptPath = this.scriptPath;
    const args = [
      '--background',
      this.templatePath,
      '--python',
      scriptPath,
      '--',
      '--mtlx-path',
      options.mtlxPath,
      '--output-png-path',
      options.outputPngPath,
      '--background-color',
      this.startOptions.backgroundColor,
      '--width',
      String(REFERENCE_IMAGE_WIDTH),
      '--height',
      String(REFERENCE_IMAGE_HEIGHT),
      '--submodules-root',
      this.submodulesRoot,
      '--renderer-name',
      this.name,
      '--render-engine',
      this.options.renderEngine,
    ];

    const logs = await execute(this.executable, args, this.activeProcesses);
    return { logs };
  }
}

export function createRenderer(context: RendererContext): FidelityRenderer {
  return new BlenderRenderer(context, BLENDER_RENDERER_OPTIONS);
}

export function createNodesRenderer(context: RendererContext): FidelityRenderer {
  return new BlenderRenderer(context, BLENDER_NODES_RENDERER_OPTIONS);
}

export function createEeveeNodesRenderer(context: RendererContext): FidelityRenderer {
  return new BlenderRenderer(context, BLENDER_EEVEE_NODES_RENDERER_OPTIONS);
}
