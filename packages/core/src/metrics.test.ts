import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { calculateImageSimilarityMetrics, calculateMetrics } from './metrics.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createSolidPngBuffer(red: number, green: number, blue: number, width = 1, height = 1): Buffer {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe('calculateImageSimilarityMetrics', () => {
  it('returns perfect still-image metrics for identical images', async () => {
    const root = await makeTempDir('fidelity-metrics-');
    const referencePath = path.join(root, 'reference.png');
    const sourcePath = path.join(root, 'source.png');
    const png = createSolidPngBuffer(128, 64, 32);
    await writeFile(referencePath, png);
    await writeFile(sourcePath, png);

    const metrics = await calculateImageSimilarityMetrics(sourcePath, referencePath);

    expect(metrics).toEqual({
      psnr: null,
    });
  });

  it('reports pixel differences with PSNR', async () => {
    const root = await makeTempDir('fidelity-metrics-');
    const referencePath = path.join(root, 'reference.png');
    const sourcePath = path.join(root, 'source.png');
    await writeFile(referencePath, createSolidPngBuffer(0, 0, 0));
    await writeFile(sourcePath, createSolidPngBuffer(255, 255, 255));

    const metrics = await calculateImageSimilarityMetrics(sourcePath, referencePath);

    expect(metrics.psnr).toBe(0);
  });

  it('rounds fractional metrics to three decimal places', async () => {
    const root = await makeTempDir('fidelity-metrics-');
    const referencePath = path.join(root, 'reference.png');
    const sourcePath = path.join(root, 'source.png');
    await writeFile(referencePath, createSolidPngBuffer(0, 0, 0));
    await writeFile(sourcePath, createSolidPngBuffer(128, 128, 128));

    const metrics = await calculateImageSimilarityMetrics(sourcePath, referencePath);

    expect(metrics.psnr).toBe(5.987);
  });

  it('fails when image dimensions differ', async () => {
    const root = await makeTempDir('fidelity-metrics-');
    const referencePath = path.join(root, 'reference.png');
    const sourcePath = path.join(root, 'source.png');
    await writeFile(referencePath, createSolidPngBuffer(0, 0, 0, 1, 1));
    await writeFile(sourcePath, createSolidPngBuffer(0, 0, 0, 2, 1));

    await expect(calculateImageSimilarityMetrics(sourcePath, referencePath)).rejects.toThrow(
      'Image dimensions mismatch',
    );
  });
});

describe('calculateMetrics', () => {
  it('writes per-material metrics for selected renderers', async () => {
    const root = await makeTempDir('fidelity-metrics-');
    const submodulesRoot = path.join(root, 'submodules');
    const materialDir = path.join(submodulesRoot, 'material-samples', 'materials', 'surfaces', 'gltf_pbr', 'included');
    const skippedMaterialDir = path.join(
      submodulesRoot,
      'material-samples',
      'materials',
      'surfaces',
      'gltf_pbr',
      'skipped',
    );
    await mkdir(materialDir, { recursive: true });
    await mkdir(skippedMaterialDir, { recursive: true });
    await writeFile(path.join(materialDir, 'included.mtlx'), '<materialx />', 'utf8');
    await writeFile(path.join(skippedMaterialDir, 'skipped.mtlx'), '<materialx />', 'utf8');
    await writeFile(path.join(materialDir, 'materialx-glsl.png'), createSolidPngBuffer(0, 0, 0));
    await writeFile(path.join(materialDir, 'threejs-new.png'), createSolidPngBuffer(255, 255, 255));

    const result = await calculateMetrics({
      submodulesRoot,
      rendererNames: ['materialx-glsl', 'threejs-new'],
      materialSelectors: ['included'],
      concurrency: 1,
    });

    const metrics = JSON.parse(await readFile(path.join(materialDir, 'metrics.json'), 'utf8')) as Record<
      string,
      { psnr: number | null }
    >;
    expect(result.total).toBe(1);
    expect(result.written).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(metrics['materialx-glsl']).toEqual({ psnr: null });
    expect(metrics['threejs-new']?.psnr).toBe(0);
  });
});
