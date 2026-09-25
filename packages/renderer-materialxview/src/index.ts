import { accessSync, existsSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { delimiter, dirname, extname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type GenerateImageResult,
  type RendererPrerequisiteCheckResult,
  type RendererStartOptions,
} from '@material-fidelity/core';
import type { RenderLogEntry } from '@material-fidelity/samples';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
const LOCAL_MATERIALX_SOURCE_ROOT = join(REPOSITORY_ROOT, 'submodules', 'MaterialX');
const LOCAL_MATERIALX_BUILD_ROOT = join(REPOSITORY_ROOT, 'build');
const GLSL_EXECUTABLE_CANDIDATES = [
  join(LOCAL_MATERIALX_BUILD_ROOT, 'materialx-glsl', 'bin', 'MaterialXView'),
  'materialx-glsl',
  'materialxview',
  'MaterialXView',
];
const METAL_EXECUTABLE_CANDIDATES = [
  join(LOCAL_MATERIALX_BUILD_ROOT, 'materialx-metal', 'bin', 'MaterialXView'),
  'materialx-metal',
];
const OSL_EXECUTABLE_CANDIDATES = [
  join(LOCAL_MATERIALX_BUILD_ROOT, 'materialx-osl', 'bin', 'materialx-osl'),
  'materialx-osl',
];
const MATERIALXVIEW_SEARCH_PATH_ENV = 'MATERIALXVIEW_SEARCH_PATH';

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--help'], {
    stdio: 'ignore',
    timeout: 3000,
    shell: false,
  });

  return !result.error;
}

function resolveCommandPath(command: string): string | undefined {
  const pathCandidates = command.includes('/') ? [''] : (process.env.PATH ?? '').split(delimiter);
  for (const pathCandidate of pathCandidates) {
    const commandPath = command.includes('/') ? command : join(pathCandidate, command);
    try {
      // Verify executability before resolving symlinks.
      accessSync(commandPath);
      return realpathSync(commandPath);
    } catch {
      continue;
    }
  }
  return undefined;
}

function inferMaterialXSearchPath(executable: string): string | undefined {
  const executablePath = resolveCommandPath(executable);
  if (!executablePath) {
    return undefined;
  }

  const materialXRoot = dirname(dirname(dirname(executablePath)));
  if (existsSync(join(materialXRoot, 'libraries')) && existsSync(join(materialXRoot, 'resources'))) {
    return materialXRoot;
  }
  return undefined;
}

function localMaterialXSourcePath(): string | undefined {
  if (
    existsSync(join(LOCAL_MATERIALX_SOURCE_ROOT, 'libraries')) &&
    existsSync(join(LOCAL_MATERIALX_SOURCE_ROOT, 'resources'))
  ) {
    return LOCAL_MATERIALX_SOURCE_ROOT;
  }
  return undefined;
}

function resolveExecutable(candidates: string[], rendererName: string): string {
  const match = candidates.find((candidate) => commandExists(candidate));
  if (!match) {
    throw new Error(`Unable to locate ${rendererName} executable. Tried: ${candidates.join(', ')}.`);
  }

  return match;
}

function uniqueSearchPaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.map((entry) => entry?.trim()).filter((entry): entry is string => Boolean(entry)))];
}

function createRenderError(message: string, logs: RenderLogEntry[]): Error & { rendererLogs: RenderLogEntry[] } {
  const error = new Error(message) as Error & { rendererLogs: RenderLogEntry[] };
  error.rendererLogs = logs;
  return error;
}

function execute(executable: string, args: string[], rendererName: string): Promise<RenderLogEntry[]> {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const logs: RenderLogEntry[] = [];
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const flushBufferedLines = (buffer: string, level: RenderLogEntry['level']): string => {
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() ?? '';
      for (const line of lines) {
        const message = line.trim();
        if (!message) {
          continue;
        }
        logs.push({ level, source: 'renderer', message });
      }
      return remainder;
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
      reject(createRenderError(error.message, logs));
    });

    processHandle.on('close', (code) => {
      stdoutBuffer = flushBufferedLines(`${stdoutBuffer}\n`, 'info');
      stderrBuffer = flushBufferedLines(`${stderrBuffer}\n`, 'warning');

      if (code === 0) {
        resolve(logs);
        return;
      }

      const message =
        logs.at(-1)?.message ||
        `${rendererName} exited with code ${String(code)}${code === null ? ' (terminated by signal)' : ''}.`;
      reject(createRenderError(message, logs));
    });
  });
}

interface MaterialXViewRendererOptions {
  name: string;
  executableCandidates: string[];
  supportsShadowsOption?: boolean;
}

class MaterialXViewRenderer implements FidelityRenderer {
  public readonly name: string;
  public readonly version = '1.0.0';
  public readonly category = 'raytracer';
  public readonly emptyReferenceImagePath = fileURLToPath(new URL('../materialxview-empty.png', import.meta.url));
  private executable: string | undefined;
  private startOptions: RendererStartOptions | undefined;

  public constructor(private readonly options: MaterialXViewRendererOptions) {
    this.name = options.name;
  }

  public async checkPrerequisites(): Promise<RendererPrerequisiteCheckResult> {
    try {
      this.executable = resolveExecutable(this.options.executableCandidates, this.name);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  public async start(options: RendererStartOptions): Promise<void> {
    this.startOptions = options;
    if (this.executable) {
      return;
    }

    const checkResult = await this.checkPrerequisites();
    if (!checkResult.success) {
      throw new Error(checkResult.message ?? 'MaterialXView prerequisites are not satisfied.');
    }
  }

  public async shutdown(): Promise<void> {
    this.startOptions = undefined;
  }

  public async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!this.executable || !this.startOptions) {
      throw new Error('Renderer has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const args = [
      '--material',
      options.mtlxPath,
      '--mesh',
      this.startOptions.modelPath,
      '--envRad',
      this.startOptions.environmentHdrPath,
      '--drawEnvironment',
      'true',
      '--screenColor',
      this.startOptions.backgroundColor,
      '--screenWidth',
      String(REFERENCE_IMAGE_WIDTH),
      '--screenHeight',
      String(REFERENCE_IMAGE_HEIGHT),
      '--enableDirectLight',
      'false',
      '--shadowMap',
      'false',
      '--captureFilename',
      options.outputPngPath,
    ];

    if (this.options.supportsShadowsOption) {
      //   args.push('--shadows', 'false');
    }

    const searchPaths = uniqueSearchPaths([
      ...(process.env[MATERIALXVIEW_SEARCH_PATH_ENV]?.split(delimiter) ?? []),
      localMaterialXSourcePath(),
      inferMaterialXSearchPath(this.executable),
    ]);
    for (const searchPath of searchPaths) {
      args.push('--path', searchPath);
    }

    const logs = await execute(this.executable, args, this.name);
    return { logs };
  }
}

export function createRenderer(): FidelityRenderer {
  return createGlslRenderer();
}

export function createGlslRenderer(): FidelityRenderer {
  return new MaterialXViewRenderer({
    name: 'materialx-glsl',
    executableCandidates: GLSL_EXECUTABLE_CANDIDATES,
  });
}

export function createMetalRenderer(): FidelityRenderer {
  return new MaterialXViewRenderer({
    name: 'materialx-metal',
    executableCandidates: METAL_EXECUTABLE_CANDIDATES,
  });
}

export function createOslRenderer(): FidelityRenderer {
  return new MaterialXViewRenderer({
    name: 'materialx-osl',
    executableCandidates: OSL_EXECUTABLE_CANDIDATES,
    supportsShadowsOption: true,
  });
}
