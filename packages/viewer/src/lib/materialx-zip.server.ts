import path from 'node:path';
import {
  createMaterialPackage,
  resolveMaterialDirectory,
  resolveMaterialFilePath,
  resolveSampleRoots,
} from '@mtlx-fidelity/samples-io';

export interface MaterialXZipPayload {
  zip: Uint8Array;
  sampleDirectory: string;
}

function normalizePathToPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export async function createMaterialXZipPayloadByTypeAndName(
  materialType: string,
  materialName: string,
): Promise<MaterialXZipPayload | undefined> {
  const roots = resolveSampleRoots();
  const materialDirectory = await resolveMaterialDirectory(roots.materialsRoot, materialType, materialName);
  if (!materialDirectory) {
    return undefined;
  }

  const materialPath = await resolveMaterialFilePath(roots.materialsRoot, materialType, materialName);
  if (!materialPath) {
    return undefined;
  }

  const pack = await createMaterialPackage({
    materialsRoot: roots.materialsRoot,
    materialDirectory,
    primaryMtlxPath: materialPath,
  });

  return {
    zip: pack.bytes,
    sampleDirectory: normalizePathToPosix(path.relative(roots.materialsRoot, materialDirectory)),
  };
}
