import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { parseRenderReport } from '@material-fidelity/samples';
import { createReferences } from './references.js';
import type { FidelityRenderer } from './types.js';

const tempDirs: string[] = [];

function createSolidPngBase64(red: number, green: number, blue: number, alpha = 255): string {
  const png = new PNG({ width: 1, height: 1 });
  png.data[0] = red;
  png.data[1] = green;
  png.data[2] = blue;
  png.data[3] = alpha;
  return PNG.sync.write(png).toString('base64');
}

const NON_BLACK_PIXEL_PNG_BASE64 = createSolidPngBase64(255, 0, 0);
const BLACK_PIXEL_PNG_BASE64 = createSolidPngBase64(0, 0, 0);
const NON_BLACK_PIXEL_PNG_BUFFER = Buffer.from(NON_BLACK_PIXEL_PNG_BASE64, 'base64');
const BLACK_PIXEL_PNG_BUFFER = Buffer.from(BLACK_PIXEL_PNG_BASE64, 'base64');
const VALID_MTLX_DOCUMENT = '<materialx version="1.39"></materialx>';

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function materialMtlxPath(materialDir: string): string {
  return path.join(materialDir, `${path.basename(materialDir)}.mtlx`);
}

function createPngWriterRenderer(base64Png: string, rendererName = 'fake'): FidelityRenderer {
  const emptyReferenceImagePath = path.join(tmpdir(), `fidelity-empty-reference-${rendererName}.png`);
  return {
    name: rendererName,
    version: '0.0.1',
    category: 'rasterizer',
    emptyReferenceImagePath,
    async checkPrerequisites() {
      await writeFile(emptyReferenceImagePath, Buffer.from(BLACK_PIXEL_PNG_BASE64, 'base64'));
      return { success: true };
    },
    async start() {},
    async shutdown() {},
    async generateImage(options) {
      await writeFile(options.outputPngPath, Buffer.from(base64Png, 'base64'));
      return { logs: [] };
    },
  };
}

function createFailingPrerequisiteRenderer(rendererName = 'fake'): FidelityRenderer {
  return {
    name: rendererName,
    version: '0.0.1',
    category: 'rasterizer',
    emptyReferenceImagePath: path.join(tmpdir(), `fidelity-empty-reference-${rendererName}.png`),
    async checkPrerequisites() {
      return { success: false, message: 'Missing fake prerequisite.' };
    },
    async start() {},
    async shutdown() {},
    async generateImage() {
      return { logs: [] };
    },
  };
}

function createTrackingRenderer(base64Png: string, rendererName = 'fake') {
  const state = {
    started: false,
    startCalls: 0,
    startOptions: undefined as Parameters<FidelityRenderer['start']>[0] | undefined,
  };
  const emptyReferenceImagePath = path.join(tmpdir(), `fidelity-empty-reference-${rendererName}.png`);
  const renderer: FidelityRenderer = {
    name: rendererName,
    version: '0.0.1',
    category: 'rasterizer',
    emptyReferenceImagePath,
    async checkPrerequisites() {
      await writeFile(emptyReferenceImagePath, Buffer.from(BLACK_PIXEL_PNG_BASE64, 'base64'));
      return { success: true };
    },
    async start(options) {
      state.started = true;
      state.startCalls += 1;
      state.startOptions = options;
    },
    async shutdown() {},
    async generateImage(options) {
      await writeFile(options.outputPngPath, Buffer.from(base64Png, 'base64'));
      return { logs: [] };
    },
  };
  return { renderer, state };
}

function createAdapterModulePngWriter(base64Png: string, adapterName = 'fake'): string {
  return `
import { writeFile } from 'node:fs/promises';
export function createAdapter() {
  return {
    name: '${adapterName}',
    version: '0.0.1',
    emptyReferenceImagePath: '/tmp/unused-empty-reference.png',
    async checkPrerequisites() { return { success: true }; },
    async start() {},
    async shutdown() {},
    async generateImage(options) {
      await writeFile(options.outputPngPath, Buffer.from('${base64Png}', 'base64'));
      return { logs: [] };
    },
  };
}
`;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe('createReferences', () => {
  it('renders a png named after the adapter beside each material', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
    });

    const outputPngPath = path.join(materialDir, 'fake.png');
    const outputTempPngPath = path.join(materialDir, 'fake-temp.png');
    const outputJsonPath = path.join(materialDir, 'fake.json');
    await access(outputPngPath);
    await access(outputJsonPath);
    await expect(access(outputTempPngPath)).rejects.toThrow('ENOENT');
    await expect(access(path.join(materialDir, 'fake.webp'))).rejects.toThrow('ENOENT');
    const reportRecord = JSON.parse(await readFile(outputJsonPath, 'utf8')) as Record<string, unknown>;
    const report = parseRenderReport(reportRecord);
    expect(report.status).toBe('success');
    if (report.status === 'validation_failed') {
      throw new Error('Expected successful render report.');
    }
    expect(report.error).toBeNull();
    expect(reportRecord.success).toBeUndefined();
    expect(reportRecord.materialPath).toBeUndefined();
    expect(reportRecord.outputPngPath).toBeUndefined();
    expect(reportRecord.startedAt).toBeUndefined();
    expect(reportRecord.completedAt).toBeUndefined();
    expect(reportRecord.durationMs).toBeUndefined();
    expect(result.rendererNames).toEqual(['fake']);
    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(result.stopped).toBe(false);
  });

  it('keeps the existing png when the rendered image RMS delta is at or below threshold', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(path.join(materialDir, 'fake.png'), NON_BLACK_PIXEL_PNG_BUFFER);
    await writeFile(path.join(materialDir, 'fake.webp'), 'legacy webp', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 1,
    });

    const finalPng = await readFile(path.join(materialDir, 'fake.png'));
    expect(finalPng.equals(NON_BLACK_PIXEL_PNG_BUFFER)).toBe(true);
    await expect(access(path.join(materialDir, 'fake-temp.png'))).rejects.toThrow('ENOENT');
    await expect(access(path.join(materialDir, 'fake.webp'))).rejects.toThrow('ENOENT');
    expect(result.rendered).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('replaces the existing png when rendered RMS delta is above threshold', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(path.join(materialDir, 'fake.png'), BLACK_PIXEL_PNG_BUFFER);

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 1,
    });

    const finalPng = await readFile(path.join(materialDir, 'fake.png'));
    expect(finalPng.equals(NON_BLACK_PIXEL_PNG_BUFFER)).toBe(true);
    await expect(access(path.join(materialDir, 'fake-temp.png'))).rejects.toThrow('ENOENT');
    expect(result.rendered).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('skips renderer/sample pairs that already have a png when skipExisting is enabled', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const existingDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'existing');
    const missingDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'missing');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const renderer = createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');
    const skippedRenderer = createFailingPrerequisiteRenderer('alt');
    renderer.generateImage = vi.fn<FidelityRenderer['generateImage']>(renderer.generateImage);

    await mkdir(existingDir, { recursive: true });
    await mkdir(missingDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(existingDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(materialMtlxPath(missingDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(path.join(existingDir, 'fake.png'), BLACK_PIXEL_PNG_BUFFER);
    await writeFile(path.join(existingDir, 'alt.png'), BLACK_PIXEL_PNG_BUFFER);
    await writeFile(path.join(missingDir, 'alt.png'), BLACK_PIXEL_PNG_BUFFER);

    const result = await createReferences({
      submodulesRoot,
      renderers: [renderer, skippedRenderer],
      rendererNames: ['fake', 'alt'],
      concurrency: 1,
      skipExisting: true,
    });

    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(renderer.generateImage).toHaveBeenCalledTimes(1);
    expect(renderer.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ mtlxPath: materialMtlxPath(missingDir) }),
    );
    expect((await readFile(path.join(existingDir, 'fake.png'))).equals(BLACK_PIXEL_PNG_BUFFER)).toBe(true);
    await expect(access(path.join(missingDir, 'fake.png'))).resolves.toBeUndefined();
  });

  it('requires the expected viewer hdr and mesh filenames', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'other_env.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'other_mesh.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      `
export function createAdapter() {
  return {
    name: 'fake',
    version: '0.0.1',
    async checkPrerequisites() { return { success: true }; },
    async start() {},
    async shutdown() {},
    async generateImage() { return { logs: [] }; },
  };
}
`,
      'utf8',
    );

    await expect(
      createReferences({
        submodulesRoot,
        renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
        rendererNames: ['fake'],
        concurrency: 1,
      }),
    ).rejects.toThrow('Missing required viewer assets');
  });

  it('applies materialSelectors to material paths', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');
    const includedDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'included');
    const skippedDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'skipped');

    await mkdir(includedDir, { recursive: true });
    await mkdir(skippedDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(includedDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(materialMtlxPath(skippedDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
      materialSelectors: ['included'],
    });

    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(1);
    await expect(access(path.join(includedDir, 'fake.png'))).resolves.toBeUndefined();
    await expect(access(path.join(skippedDir, 'fake.png'))).rejects.toThrow('ENOENT');
  });

  it('discovers showcase materials recursively', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const showcaseDir = path.join(samplesRoot, 'materials', 'showcase', 'gltf_pbr', 'showcase-glass');
    const surfacesDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'surface-plastic');

    await mkdir(showcaseDir, { recursive: true });
    await mkdir(surfacesDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });

    await writeFile(materialMtlxPath(showcaseDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(materialMtlxPath(surfacesDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
    });

    expect(result.total).toBe(2);
    expect(result.rendered).toBe(2);
    await expect(access(path.join(showcaseDir, 'fake.png'))).resolves.toBeUndefined();
    await expect(access(path.join(surfacesDir, 'fake.png'))).resolves.toBeUndefined();
  });

  it('supports regex material selectors against material directory names', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');
    const includedDir = path.join(samplesRoot, 'materials', 'surfaces', 'gltf_pbr', 'included');
    const skippedDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'skipped');

    await mkdir(includedDir, { recursive: true });
    await mkdir(skippedDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(includedDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(materialMtlxPath(skippedDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
      materialSelectors: ['/inclu/i'],
    });

    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(1);
    await expect(access(path.join(includedDir, 'fake.png'))).resolves.toBeUndefined();
    await expect(access(path.join(skippedDir, 'fake.png'))).rejects.toThrow('ENOENT');
  });

  it('does not match material selectors against parent directories', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const includedDir = path.join(samplesRoot, 'materials', 'surfaces', 'gltf_pbr', 'included');
    const skippedDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'skipped');

    await mkdir(includedDir, { recursive: true });
    await mkdir(skippedDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });

    await writeFile(materialMtlxPath(includedDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(materialMtlxPath(skippedDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    await expect(
      createReferences({
        submodulesRoot,
        renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
        rendererNames: ['fake'],
        concurrency: 2,
        materialSelectors: ['gltf_pbr'],
      }),
    ).rejects.toThrow('No .mtlx files matched --materials "gltf_pbr".');

    await expect(access(path.join(includedDir, 'fake.png'))).rejects.toThrow('ENOENT');
    await expect(access(path.join(skippedDir, 'fake.png'))).rejects.toThrow('ENOENT');
  });

  it('emits progress events with adapter names for each render task', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');
    const materialOneDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'mat-one');
    const materialTwoDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'mat-two');

    await mkdir(materialOneDir, { recursive: true });
    await mkdir(materialTwoDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(materialOneDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(materialMtlxPath(materialTwoDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );

    const events: Array<{ phase: string; rendererName: string }> = [];
    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 1,
      onProgress: (event) => {
        events.push({ phase: event.phase, rendererName: event.rendererName });
      },
    });

    expect(result.rendered).toBe(2);
    expect(events).toHaveLength(4);
    expect(events.filter((event) => event.phase === 'start')).toHaveLength(2);
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(2);
    expect(events.every((event) => event.rendererName === 'fake')).toBe(true);
  });

  it('defaults to all renderers when rendererNames is omitted', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const fakeAdapterDir = path.join(root, 'adapters', 'fake');
    const altAdapterDir = path.join(root, 'adapters', 'alt');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(fakeAdapterDir, 'dist'), { recursive: true });
    await mkdir(path.join(altAdapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(fakeAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(fakeAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-alt', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      'utf8',
    );

    const result = await createReferences({
      submodulesRoot,
      renderers: [
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      ],
      concurrency: 1,
    });

    await expect(access(path.join(materialDir, 'fake.png'))).resolves.toBeUndefined();
    await expect(access(path.join(materialDir, 'alt.png'))).resolves.toBeUndefined();
    expect(result.rendererNames.toSorted()).toEqual(['alt', 'fake']);
    expect(result.total).toBe(2);
    expect(result.rendered).toBe(2);
  });

  it('queues renders in material-first then adapter order', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const firstMaterialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'mat-one');
    const secondMaterialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'mat-two');
    const fakeAdapterDir = path.join(root, 'adapters', 'fake');
    const altAdapterDir = path.join(root, 'adapters', 'alt');

    await mkdir(firstMaterialDir, { recursive: true });
    await mkdir(secondMaterialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(fakeAdapterDir, 'dist'), { recursive: true });
    await mkdir(path.join(altAdapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(firstMaterialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(materialMtlxPath(secondMaterialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(fakeAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(fakeAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-alt', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(altAdapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      'utf8',
    );

    const startEvents: Array<{ materialPath: string; rendererName: string }> = [];
    await createReferences({
      submodulesRoot,
      renderers: [
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake'),
        createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'alt'),
      ],
      rendererNames: ['fake', 'alt'],
      concurrency: 1,
      onProgress: (event) => {
        if (event.phase === 'start') {
          startEvents.push({ materialPath: event.materialPath, rendererName: event.rendererName });
        }
      },
    });

    expect(startEvents).toHaveLength(4);
    expect(startEvents[0]?.rendererName).toBe('fake');
    expect(startEvents[1]?.rendererName).toBe('alt');
    expect(startEvents[0]?.materialPath).toBe(startEvents[1]?.materialPath);
    expect(startEvents[2]?.rendererName).toBe('fake');
    expect(startEvents[3]?.rendererName).toBe('alt');
    expect(startEvents[2]?.materialPath).toBe(startEvents[3]?.materialPath);
    expect(startEvents[0]?.materialPath).not.toBe(startEvents[2]?.materialPath);
  });

  it('marks blank-reference-similar renders as empty failures', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      createAdapterModulePngWriter(BLACK_PIXEL_PNG_BASE64),
      'utf8',
    );
    await writeFile(path.join(materialDir, 'fake.webp'), 'stale webp from previous run', 'utf8');
    await writeFile(path.join(materialDir, 'fake.png'), 'stale png from previous run', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 1,
    });

    const outputPngPath = path.join(materialDir, 'fake.png');
    const outputJsonPath = path.join(materialDir, 'fake.json');
    await expect(access(outputPngPath)).rejects.toThrow('ENOENT');
    await expect(access(path.join(materialDir, 'fake-temp.png'))).rejects.toThrow('ENOENT');
    await expect(access(path.join(materialDir, 'fake.webp'))).rejects.toThrow('ENOENT');
    await access(outputJsonPath);
    const reportRecord = JSON.parse(await readFile(outputJsonPath, 'utf8')) as Record<string, unknown>;
    const report = parseRenderReport(reportRecord);
    expect(report.status).toBe('failed');
    expect(reportRecord.success).toBeUndefined();
    if (report.status === 'validation_failed') {
      throw new Error('Expected failed render report.');
    }
    expect(report.error).not.toBeNull();
    if (report.error == null) {
      throw new Error('Expected error details.');
    }
    expect(report.error.message).toContain('Render output is empty');
    expect(report.error.stack).toBeTypeOf('string');
    expect(result.rendered).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.rendererName).toBe('fake');
    expect(result.failures[0]?.error.message).toContain('Render output is empty');
  });

  it('deletes an existing png when a renderer throws a failure', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'renderer-throws');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const renderer = createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');

    renderer.generateImage = async () => {
      throw new Error('Renderer failed');
    };

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(path.join(materialDir, 'fake.png'), 'stale png from previous run', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [renderer],
      rendererNames: ['fake'],
      concurrency: 1,
    });

    await expect(access(path.join(materialDir, 'fake.png'))).rejects.toThrow('ENOENT');
    expect(result.rendered).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.message).toContain('Renderer failed');
  });

  it('fails early when material-samples directory is missing', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');

    await mkdir(path.join(root, 'adapters'), { recursive: true });

    await expect(
      createReferences({
        submodulesRoot,
        renderers: [],
        concurrency: 1,
      }),
    ).rejects.toThrow('Missing required material-samples directory');
  });

  it('fails early when an adapter prerequisite check fails', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'default');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const adapterDir = path.join(root, 'adapters', 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await mkdir(path.join(adapterDir, 'dist'), { recursive: true });

    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');
    await writeFile(
      path.join(adapterDir, 'package.json'),
      JSON.stringify({ name: '@test/adapter-fake', main: './dist/index.js' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(adapterDir, 'dist/index.js'),
      `
export function createAdapter() {
  return {
    name: 'fake',
    version: '0.0.1',
    async checkPrerequisites() {
      return { success: false, message: 'Missing fake prerequisite.' };
    },
    async start() {},
    async shutdown() {},
    async generateImage() { return { logs: [] }; },
  };
}
`,
      'utf8',
    );

    await expect(
      createReferences({
        submodulesRoot,
        renderers: [createFailingPrerequisiteRenderer('fake')],
        rendererNames: ['fake'],
        concurrency: 1,
      }),
    ).rejects.toThrow('Renderer prerequisites are not met');
  });

  it('marks malformed material xml as a task failure and continues', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'broken');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const { renderer, state } = createTrackingRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(materialDir), '<materialx version="1.39">', 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [renderer],
      rendererNames: ['fake'],
      concurrency: 1,
    });
    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.message).toContain('MaterialX validation failed');
    await expect(access(path.join(materialDir, 'fake.json'))).resolves.toBeUndefined();
    expect(state.startCalls).toBe(1);
    expect(state.started).toBe(true);
    expect(state.startOptions).toEqual({
      modelPath: path.join(viewerDir, 'ShaderBall.glb'),
      environmentHdrPath: path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'),
      backgroundColor: '0,0,0',
    });
  });

  it('marks unsupported node categories as a task failure and continues', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'unsupported');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const { renderer, state } = createTrackingRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(
      materialMtlxPath(materialDir),
      '<materialx version="1.39"><totally_unknown_node name="mystery" /></materialx>',
      'utf8',
    );
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [renderer],
      rendererNames: ['fake'],
      concurrency: 1,
    });
    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.message).toContain('Unknown node category');
    await expect(access(path.join(materialDir, 'fake.json'))).resolves.toBeUndefined();
    expect(state.startCalls).toBe(1);
    expect(state.started).toBe(true);
  });

  it('marks missing texture references as a task failure and continues', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'missing-texture');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const { renderer, state } = createTrackingRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(
      materialMtlxPath(materialDir),
      [
        '<materialx version="1.39">',
        '  <image name="albedo" type="color3">',
        '    <input name="file" type="filename" value="textures/albedo.png" />',
        '  </image>',
        '</materialx>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [renderer],
      rendererNames: ['fake'],
      concurrency: 1,
    });
    expect(result.total).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.rendered).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.message).toContain('Missing texture file');
    await expect(access(path.join(materialDir, 'fake.json'))).resolves.toBeUndefined();
    expect(state.startCalls).toBe(1);
    expect(state.started).toBe(true);
  });

  it('renders valid materials even when another material fails validation', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const invalidMaterialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'invalid-one');
    const validMaterialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'valid-one');
    const viewerDir = path.join(samplesRoot, 'viewer');

    await mkdir(invalidMaterialDir, { recursive: true });
    await mkdir(validMaterialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(invalidMaterialDir), '<materialx version="1.39">', 'utf8');
    await writeFile(materialMtlxPath(validMaterialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
      rendererNames: ['fake'],
      concurrency: 2,
    });

    expect(result.total).toBe(2);
    expect(result.attempted).toBe(2);
    expect(result.rendered).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.materialPath).toBe(materialMtlxPath(invalidMaterialDir));
    await expect(access(path.join(validMaterialDir, 'fake.png'))).resolves.toBeUndefined();
    await expect(access(path.join(invalidMaterialDir, 'fake.png'))).rejects.toThrow('ENOENT');
    await expect(access(path.join(invalidMaterialDir, 'fake.json'))).resolves.toBeUndefined();
    await expect(access(path.join(validMaterialDir, 'fake.json'))).resolves.toBeUndefined();
  });

  it('continues rendering and writes warnings for URI texture references', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'uri-texture');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(
      materialMtlxPath(materialDir),
      [
        '<materialx version="1.39">',
        '  <image name="albedo" type="color3">',
        '    <input name="file" type="filename" value="https://example.com/albedo.png" />',
        '  </image>',
        '</materialx>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    try {
      const result = await createReferences({
        submodulesRoot,
        renderers: [createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake')],
        rendererNames: ['fake'],
        concurrency: 1,
      });

      expect(result.rendered).toBe(1);
      expect(result.failures).toHaveLength(0);
      expect(stderrSpy).toHaveBeenCalled();
      const warningOutput = stderrSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(warningOutput).toContain('Skipping texture existence check for URI');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('filters debug logs from successful render reports', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'log-filter-success');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const renderer = createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');
    renderer.generateImage = async (options) => {
      await writeFile(options.outputPngPath, Buffer.from(NON_BLACK_PIXEL_PNG_BASE64, 'base64'));
      return {
        logs: [
          { level: 'debug', source: 'browser', message: '[vite] connecting...' },
          {
            level: 'info',
            source: 'renderer',
            message: 'Blender 5.2.0 Alpha (hash d9c16a560849 built 2026-04-29 00:31:54)',
          },
          {
            level: 'info',
            source: 'browser',
            message: 'Download the React DevTools for a better development experience',
          },
          {
            level: 'warning',
            source: 'renderer',
            message: 'Image file not found: /Users/me/material-samples/viewer/irradiance/san_giuseppe_bridge_2k.hdr',
          },
          {
            level: 'info',
            source: 'renderer',
            message: 'Wrote frame to disk: /tmp/materialxview/output.png',
          },
          { level: 'info', source: 'renderer', message: 'render started' },
          { level: 'warning', source: 'renderer', message: 'minor warning' },
        ],
      };
    };

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    await createReferences({
      submodulesRoot,
      renderers: [renderer],
      rendererNames: ['fake'],
      concurrency: 1,
    });

    const report = parseRenderReport(
      JSON.parse(await readFile(path.join(materialDir, 'fake.json'), 'utf8')) as unknown,
    );
    if (report.status === 'validation_failed') {
      throw new Error('Expected render result report.');
    }
    expect(report.logs).toEqual([
      { level: 'info', source: 'renderer', message: 'render started' },
      { level: 'warning', source: 'renderer', message: 'minor warning' },
    ]);
  });

  it('filters debug logs from renderer errors', async () => {
    const root = await makeTempDir('fidelity-');
    const submodulesRoot = path.join(root, 'submodules');
    const samplesRoot = path.join(submodulesRoot, 'material-samples');
    const materialDir = path.join(samplesRoot, 'materials', 'surfaces', 'standard_surface', 'log-filter-failure');
    const viewerDir = path.join(samplesRoot, 'viewer');
    const renderer = createPngWriterRenderer(NON_BLACK_PIXEL_PNG_BASE64, 'fake');
    renderer.generateImage = async () => {
      const error = new Error('Renderer failed');
      (error as Error & { rendererLogs?: unknown }).rendererLogs = [
        { level: 'debug', source: 'browser', message: '[vite] connected.' },
        { level: 'error', source: 'renderer', message: 'shader compile failed' },
      ];
      throw error;
    };

    await mkdir(materialDir, { recursive: true });
    await mkdir(viewerDir, { recursive: true });
    await writeFile(materialMtlxPath(materialDir), VALID_MTLX_DOCUMENT, 'utf8');
    await writeFile(path.join(viewerDir, 'san_giuseppe_bridge_2k.hdr'), 'hdr', 'utf8');
    await writeFile(path.join(viewerDir, 'ShaderBall.glb'), 'glb', 'utf8');

    const result = await createReferences({
      submodulesRoot,
      renderers: [renderer],
      rendererNames: ['fake'],
      concurrency: 1,
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.logs).toEqual([
      { level: 'error', source: 'renderer', message: 'shader compile failed' },
    ]);

    const report = parseRenderReport(
      JSON.parse(await readFile(path.join(materialDir, 'fake.json'), 'utf8')) as unknown,
    );
    if (report.status === 'validation_failed') {
      throw new Error('Expected render result report.');
    }
    expect(report.logs).toEqual([{ level: 'error', source: 'renderer', message: 'shader compile failed' }]);
  });
});
