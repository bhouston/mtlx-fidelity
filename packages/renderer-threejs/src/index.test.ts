import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRenderer } from './index.js';

type AsyncUnknownFn = (...args: unknown[]) => Promise<unknown>;

const { createServerMock, launchMock } = vi.hoisted(() => ({
  createServerMock: vi.fn<AsyncUnknownFn>(),
  launchMock: vi.fn<AsyncUnknownFn>(),
}));

vi.mock('vite', () => ({
  createServer: createServerMock,
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: launchMock,
  },
}));

vi.mock('@vitejs/plugin-react', () => ({
  default: () => ({ name: 'react-test-plugin' }),
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

async function createRequiredThreeJsFiles(submodulesRoot: string): Promise<void> {
  const threeRoot = path.join(submodulesRoot, 'three.js');
  await Promise.all([
    createFile(path.join(threeRoot, 'build', 'three.module.js')),
    createFile(path.join(threeRoot, 'build', 'three.webgpu.js')),
    createFile(path.join(threeRoot, 'build', 'three.tsl.js')),
    createFile(path.join(threeRoot, 'examples', 'jsm', 'loaders', 'MaterialXLoader.js')),
  ]);
}

function hasDisposeEvaluation(page: { evaluate: { mock: { calls: unknown[][] } } }): boolean {
  const calls = page.evaluate.mock.calls;
  return calls.some((call) => String(call[0]).includes('__MTLX_DISPOSE_SCENE__'));
}

beforeEach(() => {
  createServerMock.mockReset();
  launchMock.mockReset();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })));
});

describe('threejs renderer', () => {
  it('creates a new page for each render and closes it', async () => {
    const submodulesRoot = await makeTempDir('submodules-');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerRoot = path.join(samplesRoot, 'viewer');
    await createFile(path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr'));
    await createFile(path.join(viewerRoot, 'ShaderBall.glb'));
    await createRequiredThreeJsFiles(submodulesRoot);

    const server = {
      listen: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
      resolvedUrls: { local: ['http://127.0.0.1:4173/'], network: [] },
    };
    createServerMock.mockResolvedValue(server);

    const firstPage = {
      setViewportSize: vi.fn<() => Promise<void>>(async () => undefined),
      goto: vi.fn<() => Promise<void>>(async () => undefined),
      waitForFunction: vi.fn<() => Promise<void>>(async () => undefined),
      evaluate: vi.fn<() => Promise<void>>(async () => undefined),
      screenshot: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
      on: vi.fn<() => void>(() => undefined),
      off: vi.fn<() => void>(() => undefined),
      route: vi.fn<() => Promise<void>>(async () => undefined),
      waitForTimeout: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const secondPage = {
      setViewportSize: vi.fn<() => Promise<void>>(async () => undefined),
      goto: vi.fn<() => Promise<void>>(async () => undefined),
      waitForFunction: vi.fn<() => Promise<void>>(async () => undefined),
      evaluate: vi.fn<() => Promise<void>>(async () => undefined),
      screenshot: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
      on: vi.fn<() => void>(() => undefined),
      off: vi.fn<() => void>(() => undefined),
      route: vi.fn<() => Promise<void>>(async () => undefined),
      waitForTimeout: vi.fn<() => Promise<void>>(async () => undefined),
    };

    let pageCallCount = 0;
    const browserContext = {
      newPage: vi.fn<() => Promise<typeof firstPage>>(async () => {
        pageCallCount += 1;
        return pageCallCount === 1 ? firstPage : secondPage;
      }),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const probeBrowser = {
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const browser = {
      newContext: vi.fn<() => Promise<typeof browserContext>>(async () => browserContext),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    launchMock.mockResolvedValueOnce(probeBrowser).mockResolvedValueOnce(browser);

    const renderer = createRenderer({ submodulesRoot });
    await renderer.start({
      modelPath: path.join(viewerRoot, 'ShaderBall.glb'),
      environmentHdrPath: path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr'),
      backgroundColor: '0,0,0',
    });

    const materialPath = path.join(samplesRoot, 'materials', 'example', 'example.mtlx');
    const outputOne = path.join(samplesRoot, 'materials', 'example', 'one.png');
    const outputTwo = path.join(samplesRoot, 'materials', 'example', 'two.png');
    await createFile(materialPath);

    await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputOne,
    });
    await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath: outputTwo,
    });

    expect(browserContext.newPage).toHaveBeenCalledTimes(2);
    expect(hasDisposeEvaluation(firstPage)).toBe(true);
    expect(hasDisposeEvaluation(secondPage)).toBe(true);
    expect(firstPage.close).toHaveBeenCalledTimes(1);
    expect(secondPage.close).toHaveBeenCalledTimes(1);

    await renderer.shutdown();
    expect(browserContext.close).toHaveBeenCalledTimes(1);
    expect(probeBrowser.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('returns MaterialX warning and error logs from the capture page', async () => {
    const submodulesRoot = await makeTempDir('submodules-');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerRoot = path.join(samplesRoot, 'viewer');
    await createFile(path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr'));
    await createFile(path.join(viewerRoot, 'ShaderBall.glb'));
    await createRequiredThreeJsFiles(submodulesRoot);

    const server = {
      listen: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
      resolvedUrls: { local: ['http://127.0.0.1:4173/'], network: [] },
    };
    createServerMock.mockResolvedValue(server);

    const page = {
      setViewportSize: vi.fn<() => Promise<void>>(async () => undefined),
      goto: vi.fn<() => Promise<void>>(async () => undefined),
      waitForFunction: vi.fn<() => Promise<void>>(async () => undefined),
      evaluate: vi.fn<AsyncUnknownFn>(async (callback?: unknown) => {
        const source = String(callback);
        if (source.includes('__MTLX_MATERIALX_LOG__')) {
          return [
            {
              code: 'ignored-surface-input',
              severity: 'warning',
              message: 'Input was ignored.',
              nodeName: 'base',
            },
            {
              code: 'missing-reference',
              severity: 'error',
              message: 'Missing referenced node.',
            },
          ];
        }
        return undefined;
      }),
      screenshot: vi.fn<() => Promise<void>>(async () => undefined),
      close: vi.fn<() => Promise<void>>(async () => undefined),
      on: vi.fn<() => void>(() => undefined),
      off: vi.fn<() => void>(() => undefined),
      route: vi.fn<() => Promise<void>>(async () => undefined),
      waitForTimeout: vi.fn<() => Promise<void>>(async () => undefined),
    };

    const browserContext = {
      newPage: vi.fn<() => Promise<typeof page>>(async () => page),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const probeBrowser = {
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    const browser = {
      newContext: vi.fn<() => Promise<typeof browserContext>>(async () => browserContext),
      close: vi.fn<() => Promise<void>>(async () => undefined),
    };
    launchMock.mockResolvedValueOnce(probeBrowser).mockResolvedValueOnce(browser);

    const renderer = createRenderer({ submodulesRoot });
    await renderer.start({
      modelPath: path.join(viewerRoot, 'ShaderBall.glb'),
      environmentHdrPath: path.join(viewerRoot, 'san_giuseppe_bridge_2k.hdr'),
      backgroundColor: '0,0,0',
    });

    const materialPath = path.join(samplesRoot, 'materials', 'example', 'example.mtlx');
    const outputPngPath = path.join(samplesRoot, 'materials', 'example', 'threejs-new.png');
    await createFile(materialPath);

    const result = await renderer.generateImage({
      mtlxPath: materialPath,
      outputPngPath,
    });

    expect(result.logs).toEqual([
      {
        level: 'warning',
        source: 'renderer',
        message: 'MaterialX warning: ignored-surface-input [base]: Input was ignored.',
      },
      {
        level: 'error',
        source: 'renderer',
        message: 'MaterialX error: missing-reference: Missing referenced node.',
      },
    ]);

    await renderer.shutdown();
  });
});
