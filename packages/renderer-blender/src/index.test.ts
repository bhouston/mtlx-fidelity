import { EventEmitter } from 'node:events';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEeveeNodesRenderer, createNodesRenderer, createRenderer } from './index.js';

type UnknownFn = (...args: unknown[]) => unknown;

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<UnknownFn>(),
  spawnSyncMock: vi.fn<UnknownFn>(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function createFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'x', 'utf8');
}

async function createBlenderMaterialXImporterFiles(submodulesRoot: string): Promise<void> {
  await Promise.all([
    createFile(path.join(submodulesRoot, 'blender-materialx-importer', 'materialx_importer', '__init__.py')),
    createFile(path.join(submodulesRoot, 'blender-materialx-importer', 'materialx_importer', 'importer.py')),
  ]);
}

async function makeBlenderSubmodulesRoot(): Promise<string> {
  const submodulesRoot = await makeTempDir('blender-submodules-');
  await createBlenderMaterialXImporterFiles(submodulesRoot);
  return submodulesRoot;
}

function mockSuccessfulPrerequisites(version = '4.2.0'): void {
  spawnSyncMock.mockImplementation((...args: unknown[]) => {
    const commandArgs = Array.isArray(args[1]) ? args[1] : [];
    if (commandArgs.includes('--version')) {
      return { status: 0, stdout: `Blender ${version}\n`, stderr: '' };
    }
    if (commandArgs.includes('--python-expr')) {
      return { status: 0, stdout: 'MATERIALX_VERSION=1.39.0\n', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
}

function mockSpawnExit(code: number, stdout = '', stderr = ''): void {
  spawnMock.mockImplementation(() => {
    const process = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) {
        process.stdout.emit('data', Buffer.from(stdout));
      }
      if (stderr) {
        process.stderr.emit('data', Buffer.from(stderr));
      }
      process.emit('close', code);
    });
    return process;
  });
}

function mockSpawnExitAndCreateTemplate(code: number, stdout = '', stderr = ''): void {
  spawnMock.mockImplementation((...args: unknown[]) => {
    const commandArgs = Array.isArray(args[1]) ? args[1] : [];
    const process = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    queueMicrotask(async () => {
      if (commandArgs.includes('--template-output-path')) {
        await createFile(getArgValue(commandArgs, '--template-output-path'));
      }
      if (stdout) {
        process.stdout.emit('data', Buffer.from(stdout));
      }
      if (stderr) {
        process.stderr.emit('data', Buffer.from(stderr));
      }
      process.emit('close', code);
    });
    return process;
  });
}

function mockSpawnExitSequence(results: Array<{ code: number; stdout?: string; stderr?: string }>): void {
  for (const result of results) {
    spawnMock.mockImplementationOnce((...args: unknown[]) => {
      const commandArgs = Array.isArray(args[1]) ? args[1] : [];
      const process = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      process.stdout = new EventEmitter();
      process.stderr = new EventEmitter();
      queueMicrotask(async () => {
        if (commandArgs.includes('--template-output-path')) {
          await createFile(getArgValue(commandArgs, '--template-output-path'));
        }
        if (result.stdout) {
          process.stdout.emit('data', Buffer.from(result.stdout));
        }
        if (result.stderr) {
          process.stderr.emit('data', Buffer.from(result.stderr));
        }
        process.emit('close', result.code);
      });
      return process;
    });
  }
}

function getArgValue(args: string[], name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (!value) {
    throw new Error(`Missing argument value for ${name}`);
  }
  return value;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnSyncMock.mockReset();
  delete process.env.BLENDER_EXECUTABLE;
  delete process.env.BLENDER_NODES_EXECUTABLE;
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })));
});

describe('blender renderer', () => {
  it('exposes the Blender renderer names', () => {
    expect(createRenderer({ submodulesRoot: '/tmp/submodules' }).name).toBe('blender-new');
    expect(createNodesRenderer({ submodulesRoot: '/tmp/submodules' }).name).toBe('blender-nodes');
    expect(createEeveeNodesRenderer({ submodulesRoot: '/tmp/submodules' }).name).toBe('blender-eevee-nodes');
  });

  it('exposes renderer categories', () => {
    expect(createRenderer({ submodulesRoot: '/tmp/submodules' }).category).toBe('pathtracer');
    expect(createNodesRenderer({ submodulesRoot: '/tmp/submodules' }).category).toBe('pathtracer');
    expect(createEeveeNodesRenderer({ submodulesRoot: '/tmp/submodules' }).category).toBe('rasterizer');
  });

  it('requires custom MaterialX nodes for the blender-nodes renderer', async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 5.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 5.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'MATERIALX_VERSION=1.39.0\n', stderr: '' })
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'RuntimeError: Missing MaterialX custom Blender nodes: ShaderNodeMxNoise2D\n',
      });

    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createNodesRenderer({ submodulesRoot });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Missing MaterialX custom Blender nodes');
  });

  it('requires custom MaterialX nodes for the blender-eevee-nodes renderer', async () => {
    process.env.BLENDER_NODES_EXECUTABLE = 'blender';
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 5.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 5.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'MATERIALX_VERSION=1.39.0\n', stderr: '' })
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'RuntimeError: Missing MaterialX custom Blender nodes: ShaderNodeMxNoise2D\n',
      });

    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createEeveeNodesRenderer({ submodulesRoot });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Missing MaterialX custom Blender nodes');
  });

  it('reports missing Blender prerequisites', async () => {
    spawnSyncMock.mockReturnValue({ error: new Error('not found'), status: null, stdout: '', stderr: '' });

    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createRenderer({ submodulesRoot });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unable to locate Blender executable');
  });

  it('reports missing bundled MaterialX module', async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 4.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'Blender 4.2.0\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'ModuleNotFoundError: MaterialX\n' });

    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createRenderer({ submodulesRoot });
    const result = await renderer.checkPrerequisites();

    expect(result.success).toBe(false);
    expect(result.message).toContain('bundled MaterialX module is unavailable');
  });

  it('passes render options to Blender and captures logs', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExitSequence([
      { code: 0, stdout: 'template created\n' },
      {
        code: 0,
        stdout: [
          '00:00.302  blend            | Read blend: "/tmp/material-fidelity-blender-abc/template.blend"',
          "00:04.658  render           | Saved: '/tmp/example/blender-new-temp.png'",
          'render started',
          '{"event":"blender-new-render-start","warnings":["MaterialX noise node fractal2d is using Blender fallback"]}',
          '{"event":"blender-new-render-timing","timings_ms":{"total":123.456}}',
          '{"event":"blender-new-render-finish","output":"/tmp/example/blender-new-temp.png"}',
          'render finished',
        ].join('\n'),
      },
    ]);
    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const viewerRoot = path.join(submodulesRoot, 'material-samples', 'viewer');
    const materialsRoot = path.join(submodulesRoot, 'material-samples', 'materials', 'example');
    const materialPath = path.join(materialsRoot, 'example.mtlx');
    const outputPath = path.join(materialsRoot, 'blender-new-temp.png');
    const modelPath = path.join(viewerRoot, 'ShaderBall.glb');
    const environmentHdrPath = path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr');
    await Promise.all([createFile(materialPath), createFile(modelPath), createFile(environmentHdrPath)]);

    const renderer = createRenderer({ submodulesRoot });
    await renderer.start({ modelPath, environmentHdrPath, backgroundColor: '0,0,0' });
    const result = await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputPath,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [templateExecutable, templateArgs] = spawnMock.mock.calls[0] as [string, string[]];
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(templateArgs).toEqual(
      expect.arrayContaining([
        '--background',
        '--factory-startup',
        '--template-output-path',
        expect.stringMatching(/template\.blend$/),
        '--model-path',
        modelPath,
        '--environment-hdr-path',
        environmentHdrPath,
        '--background-color',
        '0,0,0',
        '--submodules-root',
        submodulesRoot,
        '--renderer-name',
        'blender-new',
        '--render-engine',
        'CYCLES',
      ]),
    );

    const templatePath = getArgValue(templateArgs, '--template-output-path');
    const [renderExecutable, renderArgs] = spawnMock.mock.calls[1] as [string, string[]];
    expect(renderExecutable).toBe(templateExecutable);
    expect(renderArgs).toEqual(
      expect.arrayContaining([
        '--background',
        templatePath,
        '--mtlx-path',
        materialPath,
        '--output-png-path',
        outputPath,
        '--background-color',
        '0,0,0',
        '--submodules-root',
        submodulesRoot,
        '--renderer-name',
        'blender-new',
        '--render-engine',
        'CYCLES',
      ]),
    );
    expect(renderArgs).not.toContain('--model-path');
    expect(renderArgs).not.toContain('--environment-hdr-path');
    expect(result.logs.map((entry: { message: string }) => entry.message)).toEqual([
      'render started',
      'render finished',
    ]);
  });

  it('passes Eevee render engine options for the blender-eevee-nodes renderer', async () => {
    process.env.BLENDER_NODES_EXECUTABLE = 'blender';
    mockSuccessfulPrerequisites();
    mockSpawnExitSequence([
      { code: 0, stdout: 'template created\n' },
      { code: 0, stdout: 'render finished\n' },
    ]);
    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const viewerRoot = path.join(submodulesRoot, 'material-samples', 'viewer');
    const materialsRoot = path.join(submodulesRoot, 'material-samples', 'materials', 'example');
    const materialPath = path.join(materialsRoot, 'example.mtlx');
    const outputPath = path.join(materialsRoot, 'blender-eevee-nodes.png');
    const modelPath = path.join(viewerRoot, 'ShaderBall.glb');
    const environmentHdrPath = path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr');
    await Promise.all([createFile(materialPath), createFile(modelPath), createFile(environmentHdrPath)]);

    const renderer = createEeveeNodesRenderer({ submodulesRoot });
    await renderer.start({ modelPath, environmentHdrPath, backgroundColor: '0,0,0' });
    await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputPath,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [, templateArgs] = spawnMock.mock.calls[0] as [string, string[]];
    const [, renderArgs] = spawnMock.mock.calls[1] as [string, string[]];
    expect(templateArgs).toEqual(
      expect.arrayContaining(['--renderer-name', 'blender-eevee-nodes', '--render-engine', 'BLENDER_EEVEE']),
    );
    expect(renderArgs).toEqual(
      expect.arrayContaining(['--renderer-name', 'blender-eevee-nodes', '--render-engine', 'BLENDER_EEVEE']),
    );
  });

  it('requires PNG output paths', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExitAndCreateTemplate(0, 'template created\n');
    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createRenderer({ submodulesRoot });
    await renderer.start({
      modelPath: '/tmp/model.glb',
      environmentHdrPath: '/tmp/environment.hdr',
      backgroundColor: '0,0,0',
    });

    await expect(
      renderer.generateImage({
        mtlxPath: '/tmp/material.mtlx',
        outputPngPath: '/tmp/output.webp',
      }),
    ).rejects.toThrow('Output image must be .png');
  });

  it('attaches renderer logs to Blender failures', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExitSequence([
      { code: 0, stdout: 'template created\n' },
      { code: 1, stdout: 'render started\n', stderr: 'render failed\n' },
    ]);
    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createRenderer({ submodulesRoot });
    await renderer.start({
      modelPath: '/tmp/model.glb',
      environmentHdrPath: '/tmp/environment.hdr',
      backgroundColor: '0,0,0',
    });

    await expect(
      renderer.generateImage({
        mtlxPath: '/tmp/material.mtlx',
        outputPngPath: '/tmp/output.png',
      }),
    ).rejects.toMatchObject({
      message: 'render failed',
      rendererLogs: [
        { level: 'info', source: 'renderer', message: 'render started' },
        { level: 'warning', source: 'renderer', message: 'render failed' },
      ],
    });
  });

  it('removes the temporary template directory during shutdown', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExitAndCreateTemplate(0, 'template created\n');
    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createRenderer({ submodulesRoot });
    await renderer.start({
      modelPath: '/tmp/model.glb',
      environmentHdrPath: '/tmp/environment.hdr',
      backgroundColor: '0,0,0',
    });

    const [, templateArgs] = spawnMock.mock.calls[0] as [string, string[]];
    const templatePath = getArgValue(templateArgs, '--template-output-path');
    const templateDirectory = path.dirname(templatePath);
    await expect(access(templateDirectory)).resolves.toBeUndefined();

    await renderer.shutdown();

    await expect(access(templateDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports template creation when Blender exits without writing the template file', async () => {
    mockSuccessfulPrerequisites();
    mockSpawnExit(0, 'template skipped\n');
    const submodulesRoot = await makeBlenderSubmodulesRoot();
    const renderer = createRenderer({ submodulesRoot });

    await expect(
      renderer.start({
        modelPath: '/tmp/model.glb',
        environmentHdrPath: '/tmp/environment.hdr',
        backgroundColor: '0,0,0',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Blender template was not created'),
      rendererLogs: [{ level: 'info', source: 'renderer', message: 'template skipped' }],
    });
  });
});
