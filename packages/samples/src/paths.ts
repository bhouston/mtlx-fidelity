import { joinPath } from './path-utils.js';

/** fidelity-kit output folder that holds each scene's `<renderer>.avif` images. */
export const BEAUTY_OUTPUT_DIR = 'beauty';

export function getSamplesRootFromSubmodules(submodulesRoot: string): string {
  return joinPath(submodulesRoot, 'mtlx-sample-library');
}

export function getMaterialsRoot(samplesRoot: string): string {
  return joinPath(samplesRoot, 'materials');
}

export function getViewerAssetsRoot(samplesRoot: string): string {
  return joinPath(samplesRoot, 'viewer');
}

export function rendererImagePath(materialDirectory: string, rendererName: string): string {
  return joinPath(materialDirectory, BEAUTY_OUTPUT_DIR, `${rendererName}.avif`);
}
