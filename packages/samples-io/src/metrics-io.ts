import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ImageSimilarityMetricsSchema,
  METRICS_FILE_NAME,
  type ImageSimilarityMetrics,
  type MaterialMetricsFile,
} from '@mtlx-fidelity/samples';
import { pathExists } from './fs-utils.js';

export function parseRendererMetrics(value: unknown): ImageSimilarityMetrics | null {
  const parsed = ImageSimilarityMetricsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function readMetricsFile(materialDirectory: string): Promise<MaterialMetricsFile> {
  const metricsPath = path.join(materialDirectory, METRICS_FILE_NAME);
  if (!(await pathExists(metricsPath))) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(metricsPath, 'utf8')) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const metrics: MaterialMetricsFile = {};
  for (const [rendererName, rawMetrics] of Object.entries(parsed)) {
    const rendererMetrics = parseRendererMetrics(rawMetrics);
    if (rendererMetrics) {
      metrics[rendererName] = rendererMetrics;
    }
  }
  return metrics;
}

export async function writeMetricsFile(materialDirectory: string, data: MaterialMetricsFile): Promise<void> {
  const metricsPath = path.join(materialDirectory, METRICS_FILE_NAME);
  await writeFile(metricsPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
