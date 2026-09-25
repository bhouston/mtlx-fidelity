import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BUILT_IN_RENDERER_DESCRIPTORS,
  sortRendererDescriptors,
  sortMaterialTypes,
  type RendererCategory,
  type RendererDescriptor,
} from '@material-fidelity/samples';
import { MaterialSamples, pathExists, resolveSampleRoots } from '@material-fidelity/samples-io';
import { contentHashFromBytes } from './reference-asset-response.server.ts';

const MATERIAL_SOURCE_BASE_URL = 'https://github.com/bhouston/material-samples/tree/main/materials';
const HOMAGE_VIEWER_BASE_URL = 'https://materialx.ben3d.ca';
const DEFAULT_LOCAL_HOST = 'localhost:3000';
const DEFAULT_PRODUCTION_HOST = 'material-fidelity.ben3d.ca';
const VIEWER_INDEX_DATA_CACHE_ENV = 'VIEWER_INDEX_DATA_CACHE_PATH';
const DEFAULT_VIEWER_INDEX_DATA_CACHE_PATH = path.join('packages', 'viewer', '.cache', 'viewer-index-data.json');
const IMAGE_CONTENT_HASH_QUERY_PARAM = 'v';
const RENDERER_CATEGORY_LABEL: Record<RendererCategory, string> = {
  pathtracer: 'Pathtracers',
  raytracer: 'Raytracers',
  rasterizer: 'Rasterizers',
};

function toGithubSourceUrl(relativeDirectory: string): string {
  return `${MATERIAL_SOURCE_BASE_URL}/${relativeDirectory.replaceAll(path.sep, '/')}`;
}

function resolveViewerHostName(): string {
  const configuredHostName = process.env.HOST_NAME?.trim();
  if (configuredHostName) {
    return configuredHostName;
  }

  return process.env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_HOST : DEFAULT_LOCAL_HOST;
}

function toViewerOrigin(hostName: string): string {
  const protocol = hostName.startsWith('localhost') || hostName.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${protocol}://${hostName}`;
}

function toMaterialZipUrl(materialType: string, materialName: string): string {
  return `${toViewerOrigin(resolveViewerHostName())}/api/asset/${encodeURIComponent(materialType)}/${encodeURIComponent(materialName)}.mtlx.zip`;
}

function toMaterialSourceUrl(materialType: string, materialName: string): string {
  return `/api/material-source/${encodeURIComponent(materialType)}/${encodeURIComponent(materialName)}`;
}

function toLiveViewerUrl(materialType: string, materialName: string): string {
  const materialUrl = toMaterialZipUrl(materialType, materialName);
  return `${HOMAGE_VIEWER_BASE_URL}/?sourceUrl=${encodeURIComponent(materialUrl)}`;
}

function shouldHashImageUrls(): boolean {
  return process.env.NODE_ENV === 'production';
}

async function imageContentHash(filePath: string | undefined): Promise<string | null> {
  if (!filePath || !shouldHashImageUrls()) {
    return null;
  }

  return contentHashFromBytes(await readFile(filePath));
}

function toReferenceImageUrl(
  materialType: string,
  materialName: string,
  rendererName: string,
  imageHash: string | null,
): string {
  const url = `/api/reference-image/${encodeURIComponent(materialType)}/${encodeURIComponent(materialName)}/${encodeURIComponent(rendererName)}`;
  if (!imageHash || !shouldHashImageUrls()) {
    return url;
  }

  return `${url}?${IMAGE_CONTENT_HASH_QUERY_PARAM}=${encodeURIComponent(imageHash)}`;
}

export interface MaterialViewModel {
  id: string;
  type: string;
  name: string;
  displayPath: string;
  sourceUrl: string;
  liveViewerUrl: string;
  downloadMtlxZipUrl: string;
  materialSourceUrl: string;
  images: Record<string, string | null>;
  imageHashes: Record<string, string | null>;
  reports: Record<string, string | null>;
  reportSummaries: Record<string, RendererReportSummaryViewModel | null>;
  metrics: Record<string, RendererMetricsViewModel | null>;
}

export interface RendererMetricsViewModel {
  psnr: number | null;
}

export interface RendererReportSummaryViewModel {
  severity: 'none' | 'warning' | 'error';
  hasMessages: boolean;
  hasErrorMessages: boolean;
  hasException: boolean;
}

export interface MaterialTypeGroupViewModel {
  type: string;
  materials: MaterialViewModel[];
}

export interface RendererCategoryGroupViewModel {
  category: RendererCategory;
  label: string;
  renderers: string[];
}

export interface ViewerIndexViewModel {
  renderers: string[];
  rendererGroups: RendererCategoryGroupViewModel[];
  groups: MaterialTypeGroupViewModel[];
  errors: string[];
  resolvedSubmodulesRoot: string;
}

export interface ViewerRoots {
  repoRoot: string;
  submodulesRoot: string;
  materialsRoot: string;
}

export function resolveViewerRoots(): ViewerRoots {
  const roots = resolveSampleRoots();
  return {
    repoRoot: roots.repoRoot,
    submodulesRoot: roots.submodulesRoot,
    materialsRoot: roots.materialsRoot,
  };
}

function resolveViewerIndexDataCachePath(): string {
  const configuredPath = process.env[VIEWER_INDEX_DATA_CACHE_ENV]?.trim();
  const cachePath = configuredPath && configuredPath.length > 0 ? configuredPath : DEFAULT_VIEWER_INDEX_DATA_CACHE_PATH;
  if (path.isAbsolute(cachePath)) {
    return cachePath;
  }

  return path.join(resolveSampleRoots().repoRoot, cachePath);
}

async function readViewerIndexDataCache(): Promise<ViewerIndexViewModel | undefined> {
  const cachePath = resolveViewerIndexDataCachePath();

  try {
    return JSON.parse(await readFile(cachePath, 'utf8')) as ViewerIndexViewModel;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export async function writeViewerIndexDataCache(): Promise<string> {
  const data = await buildViewerIndexData();
  const cachePath = resolveViewerIndexDataCachePath();

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(data)}\n`, 'utf8');

  return cachePath;
}

function toRendererGroups(renderers: RendererDescriptor[]): RendererCategoryGroupViewModel[] {
  const groups = new Map<RendererCategory, RendererCategoryGroupViewModel>();

  for (const renderer of renderers.toSorted(sortRendererDescriptors)) {
    const group = groups.get(renderer.category) ?? {
      category: renderer.category,
      label: RENDERER_CATEGORY_LABEL[renderer.category],
      renderers: [],
    };
    group.renderers.push(renderer.name);
    groups.set(renderer.category, group);
  }

  return [...groups.values()];
}

let productionViewerIndexDataPromise: Promise<ViewerIndexViewModel> | undefined;

async function buildViewerIndexData(): Promise<ViewerIndexViewModel> {
  const roots = resolveSampleRoots();
  const errors: string[] = [];

  const hasMaterialsRoot = await pathExists(roots.materialsRoot);
  if (!hasMaterialsRoot) {
    errors.push(`Materials directory not found: ${roots.materialsRoot}`);
    return {
      renderers: [],
      rendererGroups: [],
      groups: [],
      errors,
      resolvedSubmodulesRoot: roots.submodulesRoot,
    };
  }

  const builtInRenderers = BUILT_IN_RENDERER_DESCRIPTORS;
  const rendererGroups = toRendererGroups(builtInRenderers);
  const renderers = rendererGroups.flatMap((group) => group.renderers);

  const materialSamples = new MaterialSamples({
    samplesRoot: roots.samplesRoot,
    renderers: builtInRenderers,
  });

  const indexEntries = await materialSamples.buildMaterialIndex();

  if (indexEntries.length === 0) {
    errors.push(`No .mtlx files found under: ${roots.materialsRoot}`);
  }

  const grouped = new Map<string, MaterialViewModel[]>();

  for (const entry of indexEntries) {
    const { descriptor } = entry;
    const reportSummariesByRenderer = (
      entry as typeof entry & { reportSummaries?: Record<string, RendererReportSummaryViewModel | null> }
    ).reportSummaries;
    const imageHashes = Object.fromEntries(
      await Promise.all(
        renderers.map(async (rendererName) => {
          const fsPath = entry.images[rendererName];
          return [rendererName, await imageContentHash(fsPath)] as const;
        }),
      ),
    );
    const images = Object.fromEntries(
      renderers.map((rendererName) => {
        const fsPath = entry.images[rendererName];
        const imageUrl = fsPath
          ? toReferenceImageUrl(descriptor.apiType, descriptor.apiName, rendererName, imageHashes[rendererName] ?? null)
          : null;
        return [rendererName, imageUrl] as const;
      }),
    );
    const reports = Object.fromEntries(
      renderers.map((rendererName) => {
        const fsPath = entry.reports[rendererName];
        const reportUrl = fsPath
          ? `/api/reference-report/${encodeURIComponent(descriptor.apiType)}/${encodeURIComponent(descriptor.apiName)}/${encodeURIComponent(rendererName)}`
          : null;
        return [rendererName, reportUrl] as const;
      }),
    );
    const reportSummaries = Object.fromEntries(
      renderers.map((rendererName) => [rendererName, reportSummariesByRenderer?.[rendererName] ?? null] as const),
    );
    const metrics = Object.fromEntries(
      renderers.map((rendererName) => [rendererName, entry.metrics[rendererName] ?? null] as const),
    );

    const material: MaterialViewModel = {
      id: descriptor.relativeDirectory,
      type: descriptor.type,
      name: descriptor.name,
      displayPath: descriptor.displayPath,
      sourceUrl: toGithubSourceUrl(descriptor.relativeDirectory),
      liveViewerUrl: toLiveViewerUrl(descriptor.apiType, descriptor.apiName),
      downloadMtlxZipUrl: toMaterialZipUrl(descriptor.apiType, descriptor.apiName),
      materialSourceUrl: toMaterialSourceUrl(descriptor.apiType, descriptor.apiName),
      images,
      imageHashes,
      reports,
      reportSummaries,
      metrics,
    };
    const group = grouped.get(descriptor.type) ?? [];
    group.push(material);
    grouped.set(descriptor.type, group);
  }

  const groups: MaterialTypeGroupViewModel[] = [...grouped.entries()]
    .toSorted(([leftType], [rightType]) => sortMaterialTypes(leftType, rightType))
    .map(([type, materials]) => ({
      type,
      materials: materials.toSorted((left, right) => left.displayPath.localeCompare(right.displayPath)),
    }));

  return {
    renderers,
    rendererGroups,
    groups,
    errors,
    resolvedSubmodulesRoot: roots.submodulesRoot,
  };
}

export async function getViewerIndexData(): Promise<ViewerIndexViewModel> {
  if (process.env.NODE_ENV !== 'production') {
    return buildViewerIndexData();
  }

  productionViewerIndexDataPromise ??= (async () => {
    const cachedData = await readViewerIndexDataCache();
    if (cachedData) {
      return cachedData;
    }

    await writeViewerIndexDataCache();
    const cachedDataAfterWrite = await readViewerIndexDataCache();
    if (!cachedDataAfterWrite) {
      throw new Error(`Viewer index data cache was not written to ${resolveViewerIndexDataCachePath()}`);
    }

    return cachedDataAfterWrite;
  })().catch((error: unknown) => {
    productionViewerIndexDataPromise = undefined;
    throw error;
  });

  return productionViewerIndexDataPromise;
}
