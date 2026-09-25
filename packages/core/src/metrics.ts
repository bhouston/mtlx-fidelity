import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import {
  getMaterialsRoot,
  getSamplesRootFromSubmodules,
  materialMatchesSelector,
  metricsPathForMaterialFile,
} from '@material-fidelity/samples';
import { findMtlxMaterialFiles } from '@material-fidelity/samples-io';
import type { ImageSimilarityMetrics, MaterialMetricsFile } from '@material-fidelity/samples';
import { readImageAsRawRgba } from './image-empty-check.js';

const REFERENCE_RENDERER_NAME = 'materialx-glsl';
const METRICS_DECIMAL_PLACES = 3;

export type { ImageSimilarityMetrics, MaterialMetricsFile } from '@material-fidelity/samples';

export interface CalculateMetricsOptions {
  submodulesRoot: string;
  rendererNames?: string[];
  materialSelectors?: string[];
  concurrency: number;
  onPlan?: (event: CalculateMetricsPlanEvent) => void | Promise<void>;
  onProgress?: (event: CalculateMetricsProgressEvent) => void | Promise<void>;
}

export interface CalculateMetricsPlanEvent {
  materialPaths: string[];
  rendererNames: string[];
}

export interface CalculateMetricsProgressEvent {
  phase: 'start' | 'finish';
  materialPath: string;
  metricsPath: string;
  total: number;
  started: number;
  completed: number;
  rendererNames: string[];
  success?: boolean;
  error?: Error;
}

export interface MetricsFailure {
  materialPath: string;
  metricsPath: string;
  error: Error;
}

export interface CalculateMetricsResult {
  rendererNames: string[];
  total: number;
  attempted: number;
  written: number;
  failures: MetricsFailure[];
  skippedMissingReference: number;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toMetricsPath(materialPath: string): string {
  return metricsPathForMaterialFile(materialPath);
}

function toRendererImagePath(materialPath: string, rendererName: string): string {
  return path.join(path.dirname(materialPath), `${rendererName}.png`);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(METRICS_DECIMAL_PLACES));
}

function calculatePsnr(sourceData: Buffer, referenceData: Buffer): number | null {
  let sumSquaredError = 0;
  let channelCount = 0;
  for (let offset = 0; offset < sourceData.length; offset += 4) {
    for (let channelOffset = 0; channelOffset < 3; channelOffset += 1) {
      const difference = (sourceData[offset + channelOffset] ?? 0) - (referenceData[offset + channelOffset] ?? 0);
      sumSquaredError += difference * difference;
      channelCount += 1;
    }
  }

  if (sumSquaredError === 0 || channelCount === 0) {
    return null;
  }
  return roundMetric(20 * Math.log10(255 / Math.sqrt(sumSquaredError / channelCount)));
}

export async function calculateImageSimilarityMetrics(
  sourceImagePath: string,
  referenceImagePath: string,
): Promise<ImageSimilarityMetrics> {
  const [sourceImage, referenceImage] = await Promise.all([
    readImageAsRawRgba(sourceImagePath),
    readImageAsRawRgba(referenceImagePath),
  ]);

  if (sourceImage.width !== referenceImage.width || sourceImage.height !== referenceImage.height) {
    throw new Error(
      `Image dimensions mismatch: source ${sourceImage.width}x${sourceImage.height} vs reference ${referenceImage.width}x${referenceImage.height}.`,
    );
  }

  return {
    psnr: calculatePsnr(sourceImage.data, referenceImage.data),
  };
}

function createPerfectMetrics(): ImageSimilarityMetrics {
  return {
    psnr: null,
  };
}

function normalizeStringValues(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

async function calculateMetricsForMaterial(
  materialPath: string,
  rendererNames: string[],
): Promise<MaterialMetricsFile | undefined> {
  const referenceImagePath = toRendererImagePath(materialPath, REFERENCE_RENDERER_NAME);
  if (!(await fileExists(referenceImagePath))) {
    return undefined;
  }

  const metrics: MaterialMetricsFile = {};
  for (const rendererName of rendererNames) {
    const rendererImagePath = toRendererImagePath(materialPath, rendererName);
    if (!(await fileExists(rendererImagePath))) {
      continue;
    }

    metrics[rendererName] =
      rendererName === REFERENCE_RENDERER_NAME
        ? createPerfectMetrics()
        : await calculateImageSimilarityMetrics(rendererImagePath, referenceImagePath);
  }

  return metrics;
}

export async function calculateMetrics(options: CalculateMetricsOptions): Promise<CalculateMetricsResult> {
  const samplesRoot = getSamplesRootFromSubmodules(options.submodulesRoot);
  const materialsRoot = getMaterialsRoot(samplesRoot);

  if (!(await fileExists(samplesRoot))) {
    throw new Error(`Missing required material-samples directory at ${samplesRoot}.`);
  }
  if (!(await fileExists(materialsRoot))) {
    throw new Error(`Missing required materials directory at ${materialsRoot}.`);
  }

  const materialFiles = await findMtlxMaterialFiles(materialsRoot);
  if (materialFiles.length === 0) {
    throw new Error(`No .mtlx files found under ${materialsRoot}.`);
  }

  const materialSelectors = normalizeStringValues(options.materialSelectors);
  const selectedMaterialFiles =
    materialSelectors.length > 0
      ? materialFiles.filter((materialPath) =>
          materialSelectors.some((selector) => materialMatchesSelector(materialPath, selector)),
        )
      : materialFiles;
  if (selectedMaterialFiles.length === 0) {
    throw new Error(`No .mtlx files matched --materials "${materialSelectors.join(', ')}".`);
  }

  const rendererNames = normalizeStringValues(options.rendererNames);
  if (rendererNames.length === 0) {
    throw new Error('At least one renderer must be provided to calculate metrics.');
  }

  await options.onPlan?.({ materialPaths: selectedMaterialFiles, rendererNames });

  const failures: MetricsFailure[] = [];
  let started = 0;
  let completed = 0;
  let attempted = 0;
  let written = 0;
  let skippedMissingReference = 0;
  const limit = pLimit(Math.max(1, options.concurrency));

  await Promise.all(
    selectedMaterialFiles.map((materialPath) =>
      limit(async () => {
        const metricsPath = toMetricsPath(materialPath);
        started += 1;
        await options.onProgress?.({
          phase: 'start',
          materialPath,
          metricsPath,
          total: selectedMaterialFiles.length,
          started,
          completed,
          rendererNames,
        });

        let error: Error | undefined;
        let success = false;
        try {
          const metrics = await calculateMetricsForMaterial(materialPath, rendererNames);
          if (!metrics) {
            skippedMissingReference += 1;
          } else {
            await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
            written += 1;
          }
          success = true;
        } catch (caughtError) {
          error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
          failures.push({ materialPath, metricsPath, error });
        }

        attempted += 1;
        completed += 1;
        await options.onProgress?.({
          phase: 'finish',
          materialPath,
          metricsPath,
          total: selectedMaterialFiles.length,
          started,
          completed,
          rendererNames,
          success,
          error,
        });
      }),
    ),
  );

  return {
    rendererNames,
    total: selectedMaterialFiles.length,
    attempted,
    written,
    failures,
    skippedMissingReference,
  };
}
