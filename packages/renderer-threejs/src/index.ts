import { access, mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import {
  REFERENCE_IMAGE_HEIGHT,
  REFERENCE_IMAGE_WIDTH,
  type FidelityRenderer,
  type GenerateImageOptions,
  type GenerateImageResult,
  type RendererContext,
  type RendererPrerequisiteCheckResult,
  type RendererStartOptions,
} from '@material-fidelity/core';
import type { RenderLogEntry } from '@material-fidelity/samples';

interface RuntimeState {
  baseUrl: string;
  browser: Browser;
  context: BrowserContext;
  server: ViteDevServer;
}

type MaterialXLoaderVariant = 'custom' | 'official';
type MaterialXLogEntry = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeName?: string;
};

const VIEWER_HDR_FILENAME = 'san_giuseppe_bridge_2k.hdr';
const VIEWER_MODEL_FILENAME = 'ShaderBall.glb';
const VIEWER_ENVIRONMENT_ROTATION_DEGREES = -90;
const GPU_BROWSER_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgpu', '--enable-unsafe-webgpu'];
const POST_IDLE_DELAY_MS = 150;
const POST_IDLE_RENDER_PASSES = 3;

function createVendoredThreeAliases(submodulesRoot: string): { find: string | RegExp; replacement: string }[] {
  const threeRoot = join(submodulesRoot, 'three.js');
  return [
    { find: /^three$/, replacement: join(threeRoot, 'build', 'three.module.js') },
    { find: /^three\/webgpu$/, replacement: join(threeRoot, 'build', 'three.webgpu.js') },
    { find: /^three\/tsl$/, replacement: join(threeRoot, 'build', 'three.tsl.js') },
    { find: /^three\/addons\//, replacement: `${join(threeRoot, 'examples', 'jsm')}/` },
  ];
}

function toFsUrlPath(absolutePath: string): string {
  return `/@fs/${absolutePath.replaceAll('\\', '/')}`;
}

async function assertFileExists(filePath: string): Promise<void> {
  await access(filePath);
}

async function findMissingFiles(filePaths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const filePath of filePaths) {
    try {
      await access(filePath);
    } catch {
      missing.push(filePath);
    }
  }
  return missing;
}

function readGlobalError(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const value = Reflect.get(globalThis, '__MTLX_CAPTURE_ERROR__');
    return typeof value === 'string' ? value : undefined;
  });
}

function isMaterialXLogEntry(candidate: unknown): candidate is MaterialXLogEntry {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const value = candidate as Record<string, unknown>;
  return (
    typeof value.code === 'string' &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.message === 'string' &&
    (value.nodeName === undefined || typeof value.nodeName === 'string')
  );
}

function formatMaterialXLogEntry(entry: MaterialXLogEntry): string {
  const nodeName = entry.nodeName ? ` [${entry.nodeName}]` : '';
  return `MaterialX ${entry.severity}: ${entry.code}${nodeName}: ${entry.message}`;
}

async function readMaterialXLogs(page: Page): Promise<RenderLogEntry[]> {
  const entries = await page.evaluate(() => {
    const value = Reflect.get(globalThis, '__MTLX_MATERIALX_LOG__');
    return Array.isArray(value) ? value : [];
  });
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.filter(isMaterialXLogEntry).map((entry) => ({
    level: entry.severity,
    source: 'renderer',
    message: formatMaterialXLogEntry(entry),
  }));
}

async function renderAdditionalFrames(page: Page, passes: number): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await page.evaluate(() => {
      const forceRenderCandidate = Reflect.get(globalThis, '__MTLX_FORCE_RENDER__');
      const forceRender = typeof forceRenderCandidate === 'function' ? forceRenderCandidate : undefined;
      forceRender?.();
    });
    await page.waitForTimeout(16);
  }
}

async function disposePageScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const disposeCandidate = Reflect.get(globalThis, '__MTLX_DISPOSE_SCENE__');
    const disposeScene = typeof disposeCandidate === 'function' ? disposeCandidate : undefined;
    disposeScene?.();
    Reflect.deleteProperty(globalThis, '__MTLX_DISPOSE_SCENE__');
    Reflect.set(globalThis, '__MTLX_FORCE_RENDER__', undefined);
  });
}

function toLogLevel(type: string): RenderLogEntry['level'] {
  if (type === 'error') return 'error';
  if (type === 'warning') return 'warning';
  if (type === 'debug') return 'debug';
  return 'info';
}

function createRenderError(message: string, logs: RenderLogEntry[]): Error & { rendererLogs: RenderLogEntry[] } {
  const error = new Error(message) as Error & { rendererLogs: RenderLogEntry[] };
  error.rendererLogs = logs;
  return error;
}

function buildGpuBrowserArgs(): string[] {
  if (process.platform === 'darwin') {
    return [...GPU_BROWSER_ARGS, '--use-angle=metal'];
  }

  return GPU_BROWSER_ARGS;
}

async function launchGpuBrowser(): Promise<Browser> {
  const args = buildGpuBrowserArgs();

  try {
    // Prefer the system Chrome channel for better hardware acceleration support.
    return await chromium.launch({
      channel: 'chrome',
      headless: true,
      args,
    });
  } catch {
    // Fallback to bundled Chromium if Chrome channel is not available.
    return chromium.launch({
      headless: true,
      args,
    });
  }
}

class ThreeJsRenderer implements FidelityRenderer {
  public readonly name: string;
  public readonly version = '0.1.0';
  public readonly category = 'rasterizer';
  public readonly emptyReferenceImagePath: string;
  private readonly submodulesRoot: string;
  private readonly materialXLoaderVariant: MaterialXLoaderVariant;
  private prerequisitesValidated = false;
  private runtimeState: RuntimeState | undefined;
  private startOptions: RendererStartOptions | undefined;

  public constructor(
    context: RendererContext,
    options: {
      name: string;
      materialXLoaderVariant: MaterialXLoaderVariant;
    },
  ) {
    this.name = options.name;
    this.materialXLoaderVariant = options.materialXLoaderVariant;
    this.submodulesRoot = context.submodulesRoot;
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    this.emptyReferenceImagePath = join(packageRoot, 'threejs-empty.png');
  }

  public async checkPrerequisites(): Promise<RendererPrerequisiteCheckResult> {
    if (this.prerequisitesValidated) {
      return { success: true };
    }

    try {
      const samplesRoot = join(this.submodulesRoot, 'material-samples');
      const viewerRoot = join(samplesRoot, 'viewer');
      const requiredFiles = [join(viewerRoot, VIEWER_HDR_FILENAME), join(viewerRoot, VIEWER_MODEL_FILENAME)];
      if (this.materialXLoaderVariant === 'custom') {
        const threeRoot = join(this.submodulesRoot, 'three.js');
        requiredFiles.push(
          join(threeRoot, 'build', 'three.module.js'),
          join(threeRoot, 'build', 'three.webgpu.js'),
          join(threeRoot, 'build', 'three.tsl.js'),
          join(threeRoot, 'examples', 'jsm', 'loaders', 'MaterialXLoader.js'),
        );
      }
      const missingFiles = await findMissingFiles(requiredFiles);
      if (missingFiles.length > 0) {
        return { success: false, message: `Missing required viewer assets: ${missingFiles.join(', ')}` };
      }

      const browser = await launchGpuBrowser();
      await browser.close();
      this.prerequisitesValidated = true;
      return { success: true };
    } catch (error) {
      this.prerequisitesValidated = false;
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  public async start(options: RendererStartOptions): Promise<void> {
    if (this.runtimeState) {
      return;
    }

    if (!this.prerequisitesValidated) {
      const checkResult = await this.checkPrerequisites();
      if (!checkResult.success) {
        throw new Error(checkResult.message ?? `${this.name} prerequisites are not satisfied.`);
      }
    }

    await Promise.all([assertFileExists(options.environmentHdrPath), assertFileExists(options.modelPath)]);

    const viewerAppRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'viewer');
    const usesVendoredThree = this.materialXLoaderVariant === 'custom';
    const server = await createServer({
      appType: 'spa',
      root: viewerAppRoot,
      cacheDir: join(viewerAppRoot, 'node_modules', `.vite-${this.name}`),
      logLevel: 'error',
      plugins: [react()],
      resolve: usesVendoredThree
        ? {
            alias: createVendoredThreeAliases(this.submodulesRoot),
          }
        : undefined,
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        fs: {
          allow: [viewerAppRoot, this.submodulesRoot],
        },
      },
    });

    await server.listen();
    const baseUrl = server.resolvedUrls?.local.at(0);
    if (!baseUrl) {
      await server.close();
      throw new Error('Unable to resolve the Three.js viewer server URL.');
    }

    const browser = await launchGpuBrowser();
    const context = await browser.newContext({
      viewport: { width: REFERENCE_IMAGE_WIDTH, height: REFERENCE_IMAGE_HEIGHT },
      deviceScaleFactor: 1,
    });

    this.runtimeState = {
      baseUrl,
      browser,
      context,
      server,
    };
    this.startOptions = options;
  }

  public async shutdown(): Promise<void> {
    if (!this.runtimeState) {
      return;
    }

    const { context, browser, server } = this.runtimeState;
    this.runtimeState = undefined;
    this.startOptions = undefined;
    await Promise.allSettled([context.close(), browser.close(), server.close()]);
  }

  public async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!this.runtimeState || !this.startOptions) {
      throw new Error('Renderer has not been started. Call start() before generateImage().');
    }

    if (extname(options.outputPngPath).toLowerCase() !== '.png') {
      throw new Error(`Output image must be .png: ${options.outputPngPath}`);
    }

    await mkdir(dirname(options.outputPngPath), { recursive: true });

    const page = await this.runtimeState.context.newPage();
    const logs: RenderLogEntry[] = [];
    let hasReadMaterialXLogs = false;
    let browserError: Error | undefined;
    let resolveBrowserError: (() => void) | undefined;
    const browserErrorSignal = new Promise<void>((resolve) => {
      resolveBrowserError = resolve;
    });
    const recordBrowserError = (message: string): void => {
      if (browserError) {
        return;
      }
      browserError = createRenderError(message, logs);
      resolveBrowserError?.();
    };
    const onConsole = (message: ConsoleMessage): void => {
      const level = toLogLevel(message.type());
      logs.push({
        level,
        source: 'browser',
        message: message.text(),
      });
      if (level === 'error') {
        recordBrowserError(`Browser console error: ${message.text()}`);
      }
    };
    const onPageError = (error: Error): void => {
      logs.push({
        level: 'error',
        source: 'browser',
        message: error.message,
      });
      recordBrowserError(`Browser page error: ${error.message}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    const captureMaterialXLogs = async (): Promise<void> => {
      if (hasReadMaterialXLogs) {
        return;
      }
      hasReadMaterialXLogs = true;
      logs.push(...(await readMaterialXLogs(page)));
    };
    try {
      await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
      await page.setViewportSize({
        width: REFERENCE_IMAGE_WIDTH,
        height: REFERENCE_IMAGE_HEIGHT,
      });

      const url = new URL('/index.html', this.runtimeState.baseUrl);
      url.searchParams.set('mtlxPath', toFsUrlPath(options.mtlxPath));
      url.searchParams.set('modelPath', toFsUrlPath(this.startOptions.modelPath));
      url.searchParams.set('environmentHdrPath', toFsUrlPath(this.startOptions.environmentHdrPath));
      url.searchParams.set('environmentRotationDegrees', String(VIEWER_ENVIRONMENT_ROTATION_DEGREES));
      url.searchParams.set('backgroundColor', this.startOptions.backgroundColor);
      url.searchParams.set('materialXLoaderVariant', this.materialXLoaderVariant);
      if (this.materialXLoaderVariant === 'custom') {
        url.searchParams.set(
          'interfaceValidatorPath',
          toFsUrlPath(
            join(
              this.submodulesRoot,
              'three.js',
              'examples',
              'jsm',
              'loaders',
              'materialx',
              'MaterialXInterfaceValidation.js',
            ),
          ),
        );
      }

      await page.goto(url.toString(), { waitUntil: 'networkidle' });
      await Promise.race([
        page.waitForFunction(() => Reflect.get(globalThis, '__MTLX_CAPTURE_DONE__') === true, undefined, {
          timeout: 60_000,
        }),
        browserErrorSignal,
      ]);
      await captureMaterialXLogs();

      const renderError = await readGlobalError(page);
      if (renderError) {
        throw createRenderError(renderError, logs);
      }
      if (browserError) {
        throw browserError;
      }
      await page.waitForTimeout(POST_IDLE_DELAY_MS);
      await renderAdditionalFrames(page, POST_IDLE_RENDER_PASSES);

      const postIdleRenderError = await readGlobalError(page);
      if (postIdleRenderError) {
        throw createRenderError(postIdleRenderError, logs);
      }
      if (browserError) {
        throw browserError;
      }

      await page.screenshot({
        path: options.outputPngPath,
        type: 'png',
      });
      return { logs };
    } catch (error) {
      await captureMaterialXLogs().catch(() => undefined);
      if (error && typeof error === 'object' && 'rendererLogs' in error) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw createRenderError(message, logs);
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      await Promise.allSettled([disposePageScene(page)]);
      await page.close();
    }
  }
}

export function createRenderer(context?: RendererContext): FidelityRenderer {
  if (!context) {
    throw new Error('ThreeJS New renderer requires renderer context with submodulesRoot.');
  }

  return new ThreeJsRenderer(context, {
    name: 'threejs-new',
    materialXLoaderVariant: 'custom',
  });
}

export function createCurrentRenderer(context?: RendererContext): FidelityRenderer {
  if (!context) {
    throw new Error('ThreeJS Current renderer requires renderer context with submodulesRoot.');
  }

  return new ThreeJsRenderer(context, {
    name: 'threejs-current',
    materialXLoaderVariant: 'official',
  });
}
