import { dirname, joinPath } from './path-utils.js';

export const METRICS_FILE_NAME = 'metrics.json';

export function getSamplesRootFromSubmodules(submodulesRoot: string): string {
  return joinPath(submodulesRoot, 'material-samples');
}

export function getMaterialsRoot(samplesRoot: string): string {
  return joinPath(samplesRoot, 'materials');
}

export function getViewerAssetsRoot(samplesRoot: string): string {
  return joinPath(samplesRoot, 'viewer');
}

export function metricsFilePath(materialDirectory: string): string {
  return joinPath(materialDirectory, METRICS_FILE_NAME);
}

export function rendererPngPath(materialDirectory: string, rendererName: string): string {
  return joinPath(materialDirectory, `${rendererName}.png`);
}

export function rendererReportPath(materialDirectory: string, rendererName: string): string {
  return joinPath(materialDirectory, `${rendererName}.json`);
}

/** Same layout as `packages/core` references output path. */
export function metricsPathForMaterialFile(materialFilePath: string): string {
  return joinPath(dirname(materialFilePath), METRICS_FILE_NAME);
}
