import { z } from 'zod';

/** Matches `@material-fidelity/core` `RendererCategory`. */
export type RendererCategory = 'pathtracer' | 'raytracer' | 'rasterizer';

export interface RendererDescriptor {
  name: string;
  category: RendererCategory;
  sortIndex: number;
  description: string;
  packageName: string;
  sourceName: string;
  sourceUrl: string;
}

export const ImageSimilarityMetricsSchema = z.object({
  psnr: z.number().finite().nullable(),
});

export type ImageSimilarityMetrics = z.infer<typeof ImageSimilarityMetricsSchema>;

export type MaterialMetricsFile = Record<string, ImageSimilarityMetrics>;

/** Filesystem-derived material record (no viewer URLs). */
export interface MaterialDescriptor {
  type: string;
  apiType: string;
  apiName: string;
  name: string;
  absoluteDirectory: string;
  relativeDirectory: string;
  displayPath: string;
}

export type RendererReportSeverity = 'none' | 'warning' | 'error';

export interface RendererReportSummary {
  severity: RendererReportSeverity;
  hasMessages: boolean;
  hasErrorMessages: boolean;
  hasException: boolean;
}

export interface MaterialIndexEntry {
  descriptor: MaterialDescriptor;
  images: Record<string, string | null>;
  reports: Record<string, string | null>;
  reportSummaries: Record<string, RendererReportSummary | null>;
  metrics: Record<string, ImageSimilarityMetrics | null>;
}

/** Optional root `<materialx>` metadata for packaged archives (draft `.mtlz` convention). */
export interface MtlzMetadata {
  materialx_name?: string;
  materialx_authors?: string;
  materialx_license?: string;
  materialx_license_url?: string;
  materialx_source_url?: string;
  materialx_version?: string;
  materialx_description?: string;
  materialx_keywords?: string;
}

export interface SampleRoots {
  repoRoot: string;
  submodulesRoot: string;
  samplesRoot: string;
  materialsRoot: string;
}
