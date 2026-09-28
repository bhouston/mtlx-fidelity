import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MtlzMetadata } from '@mtlx-fidelity/samples';
import JSZip from 'jszip';

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.exr',
  '.gif',
  '.hdr',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
]);

const QUOTED_VALUE_REGEX = /["']([^"']+)["']/g;

export interface CreateMaterialPackageOptions {
  materialsRoot: string;
  materialDirectory: string;
  primaryMtlxPath: string;
  metadata?: MtlzMetadata;
}

export interface MaterialPackageResult {
  bytes: Uint8Array;
  suggestedBasename: string;
  /** POSIX path of material dir relative to materials root */
  sampleDirectory: string;
}

function normalizePathToPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isImagePath(value: string): boolean {
  const ext = path.extname(value).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function injectMaterialxMetadata(xml: string, metadata: MtlzMetadata): string {
  const entries = Object.entries(metadata).filter(
    ([key, value]) => key.length > 0 && value != null && String(value).length > 0,
  );
  if (entries.length === 0) {
    return xml;
  }
  const attrStr = entries.map(([key, value]) => `${key}="${escapeXmlAttribute(String(value))}"`).join(' ');
  return xml.replace(/<materialx(\s[^>]*)?>/, (match) => {
    if (match.endsWith('/>')) {
      return match;
    }
    return match.replace(/>$/, ` ${attrStr}>`);
  });
}

function resolveUnderMaterialsRoot(
  materialDirectory: string,
  materialsRoot: string,
  referencedPath: string,
): { absolutePath: string } | undefined {
  if (referencedPath.includes('\0')) {
    return undefined;
  }

  const absolutePath = path.resolve(materialDirectory, referencedPath);
  const materialsRootPrefix = `${path.resolve(materialsRoot)}${path.sep}`;
  const normalizedAbsolutePath = path.resolve(absolutePath);
  if (!normalizedAbsolutePath.startsWith(materialsRootPrefix)) {
    return undefined;
  }

  const relativeFromMaterial = path.relative(materialDirectory, normalizedAbsolutePath);
  if (relativeFromMaterial.startsWith('..') || path.isAbsolute(relativeFromMaterial)) {
    return undefined;
  }

  return { absolutePath: normalizedAbsolutePath };
}

function archivePathForAsset(materialDirectory: string, absolutePath: string): string {
  const rel = normalizePathToPosix(path.relative(materialDirectory, absolutePath));
  const prefix = isImagePath(absolutePath) ? 'textures' : 'includes';
  return `${prefix}/${rel}`;
}

function collectQuotedInnerPaths(materialXml: string): string[] {
  const referenced = new Set<string>();
  for (const match of materialXml.matchAll(QUOTED_VALUE_REGEX)) {
    const rawValue = match[1]?.trim();
    if (
      !rawValue ||
      rawValue.startsWith('http://') ||
      rawValue.startsWith('https://') ||
      rawValue.startsWith('data:')
    ) {
      continue;
    }

    const pathWithoutQuery = rawValue.split('#')[0]?.split('?')[0] ?? rawValue;
    if (pathWithoutQuery.includes('://')) {
      continue;
    }

    referenced.add(rawValue);
    referenced.add(pathWithoutQuery);
  }
  return [...referenced];
}

function rewriteQuotedPaths(xml: string, replacementMap: Map<string, string>): string {
  return xml.replace(QUOTED_VALUE_REGEX, (fullMatch, inner: string) => {
    const trimmed = inner.trim();
    const withoutQuery = trimmed.split('#')[0]?.split('?')[0] ?? trimmed;
    const replacement = replacementMap.get(trimmed) ?? replacementMap.get(withoutQuery) ?? replacementMap.get(inner);
    if (replacement === undefined) {
      return fullMatch;
    }
    const quote = fullMatch[0] ?? '"';
    const closingQuote = quote === '"' ? '"' : "'";
    return `${quote}${replacement}${closingQuote}`;
  });
}

/**
 * Builds a normative MaterialX single-file package (draft `.mtlz` layout).
 * Bytes are valid whether served as `.mtlz` or `.mtlx.zip`.
 */
export async function createMaterialPackage(options: CreateMaterialPackageOptions): Promise<MaterialPackageResult> {
  const { materialsRoot, materialDirectory, primaryMtlxPath, metadata } = options;
  const primaryResolved = path.resolve(primaryMtlxPath);
  const materialDirResolved = path.resolve(materialDirectory);

  let materialXml = await readFile(primaryMtlxPath, 'utf8');
  if (metadata) {
    materialXml = injectMaterialxMetadata(materialXml, metadata);
  }

  const replacementMap = new Map<string, string>();
  const assetEntries = new Map<string, { absolutePath: string; archivePath: string }>();

  const innerPaths = collectQuotedInnerPaths(materialXml);
  for (const inner of innerPaths) {
    const pathWithoutQuery = inner.split('#')[0]?.split('?')[0] ?? inner;
    const resolved = resolveUnderMaterialsRoot(materialDirectory, materialsRoot, pathWithoutQuery);
    if (!resolved) {
      continue;
    }

    if (resolved.absolutePath === primaryResolved) {
      continue;
    }

    let fileStat;
    try {
      fileStat = await stat(resolved.absolutePath);
    } catch {
      continue;
    }
    if (!fileStat.isFile()) {
      continue;
    }

    const archivePath = archivePathForAsset(materialDirResolved, resolved.absolutePath);
    assetEntries.set(archivePath, { absolutePath: resolved.absolutePath, archivePath });

    replacementMap.set(inner, archivePath);
    replacementMap.set(pathWithoutQuery, archivePath);
    replacementMap.set(inner.trim(), archivePath);
  }

  const rewrittenXml = rewriteQuotedPaths(materialXml, replacementMap);
  const rootMtlxName = path.basename(primaryMtlxPath);

  const zip = new JSZip();

  const includesArchivePaths = [...assetEntries.keys()].filter((key) => key.startsWith('includes/')).toSorted();
  const texturesArchivePaths = [...assetEntries.keys()].filter((key) => key.startsWith('textures/')).toSorted();

  zip.file(rootMtlxName, rewrittenXml, { compression: 'STORE' });

  for (const archivePath of includesArchivePaths) {
    const entry = assetEntries.get(archivePath);
    if (!entry) {
      continue;
    }
    const data = await readFile(entry.absolutePath);
    zip.file(archivePath, data, { compression: 'STORE' });
  }

  for (const archivePath of texturesArchivePaths) {
    const entry = assetEntries.get(archivePath);
    if (!entry) {
      continue;
    }
    const data = await readFile(entry.absolutePath);
    zip.file(archivePath, data, { compression: 'STORE' });
  }

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'STORE',
    comment: 'mtlx-fidelity mtlz-layout',
  });

  const suggestedBasename = rootMtlxName.replace(/\.mtlx$/i, '') || 'material';
  const sampleDirectory = normalizePathToPosix(path.relative(materialsRoot, materialDirResolved));

  return {
    bytes,
    suggestedBasename,
    sampleDirectory,
  };
}
