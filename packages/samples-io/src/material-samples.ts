import {
  getMaterialsRoot,
  rendererImagePath,
  rendererReportPath,
  sortRendererDescriptors,
  toMaterialDescriptor,
  type ImageSimilarityMetrics,
  type MaterialIndexEntry,
  type MaterialMetricsFile,
  type MtlzMetadata,
  type RenderReport,
  type RendererDescriptor,
} from '@mtlx-fidelity/samples';
import { findMtlxMaterialFiles } from './discovery.js';
import { pathExists } from './fs-utils.js';
import { createMaterialPackage, type MaterialPackageResult } from './material-package.js';
import { readMetricsFile, writeMetricsFile } from './metrics-io.js';
import { readRendererReportJson, summarizeRendererReport } from './renderer-report-io.js';
import { resolveMaterialDirectory, resolveSingleMtlxFileInDirectory } from './resolution.js';

export interface MaterialSamplesOptions {
  samplesRoot: string;
  renderers: RendererDescriptor[];
}

export class MaterialSamples {
  readonly samplesRoot: string;
  readonly materialsRoot: string;
  readonly renderers: readonly RendererDescriptor[];

  constructor(options: MaterialSamplesOptions) {
    this.samplesRoot = options.samplesRoot;
    this.materialsRoot = getMaterialsRoot(options.samplesRoot);
    this.renderers = [...options.renderers].toSorted(sortRendererDescriptors);
  }

  async listMtlxPaths(): Promise<string[]> {
    return findMtlxMaterialFiles(this.materialsRoot);
  }

  async primaryMtlxPath(materialDir: string): Promise<string | undefined> {
    return resolveSingleMtlxFileInDirectory(materialDir);
  }

  async resolveMaterialDirectory(materialType: string, materialName: string): Promise<string | undefined> {
    return resolveMaterialDirectory(this.materialsRoot, materialType, materialName);
  }

  async resolveMaterialFilePath(materialType: string, materialName: string): Promise<string | undefined> {
    const dir = await this.resolveMaterialDirectory(materialType, materialName);
    if (!dir) {
      return undefined;
    }
    return resolveSingleMtlxFileInDirectory(dir);
  }

  async resolveReferenceImagePath(
    materialType: string,
    materialName: string,
    rendererName: string,
  ): Promise<string | undefined> {
    const dir = await this.resolveMaterialDirectory(materialType, materialName);
    if (!dir) {
      return undefined;
    }
    const imagePath = rendererImagePath(dir, rendererName);
    return (await pathExists(imagePath)) ? imagePath : undefined;
  }

  async resolveReferenceReportPath(
    materialType: string,
    materialName: string,
    rendererName: string,
  ): Promise<string | undefined> {
    const dir = await this.resolveMaterialDirectory(materialType, materialName);
    if (!dir) {
      return undefined;
    }
    const reportPath = rendererReportPath(dir, rendererName);
    return (await pathExists(reportPath)) ? reportPath : undefined;
  }

  readMetrics(materialDir: string): Promise<MaterialMetricsFile> {
    return readMetricsFile(materialDir);
  }

  writeMetrics(materialDir: string, data: MaterialMetricsFile): Promise<void> {
    return writeMetricsFile(materialDir, data);
  }

  readRendererReport(materialDir: string, rendererName: string): Promise<RenderReport | undefined> {
    return readRendererReportJson(materialDir, rendererName);
  }

  /**
   * Full index: materials × configured renderers with filesystem paths for PNG/report when present.
   */
  async buildMaterialIndex(): Promise<MaterialIndexEntry[]> {
    const materialFiles = await this.listMtlxPaths();
    const rendererNames = this.renderers.map((renderer) => renderer.name);
    const entries: MaterialIndexEntry[] = [];

    for (const materialFilePath of materialFiles) {
      const descriptor = toMaterialDescriptor(materialFilePath, this.materialsRoot);
      const metricsFile = await readMetricsFile(descriptor.absoluteDirectory);

      const images: Record<string, string | null> = {};
      const reports: Record<string, string | null> = {};
      const reportSummaries: MaterialIndexEntry['reportSummaries'] = {};
      const metrics: Record<string, ImageSimilarityMetrics | null> = {};

      for (const rendererName of rendererNames) {
        const imagePath = rendererImagePath(descriptor.absoluteDirectory, rendererName);
        const reportPath = rendererReportPath(descriptor.absoluteDirectory, rendererName);
        images[rendererName] = (await pathExists(imagePath)) ? imagePath : null;
        const hasReport = await pathExists(reportPath);
        reports[rendererName] = hasReport ? reportPath : null;
        if (hasReport) {
          const report = await readRendererReportJson(descriptor.absoluteDirectory, rendererName);
          reportSummaries[rendererName] = report ? summarizeRendererReport(report) : null;
        } else {
          reportSummaries[rendererName] = null;
        }
        metrics[rendererName] = metricsFile[rendererName] ?? null;
      }

      entries.push({
        descriptor,
        images,
        reports,
        reportSummaries,
        metrics,
      });
    }

    return entries;
  }

  async createMaterialPackage(params: {
    materialType: string;
    materialName: string;
    metadata?: MtlzMetadata;
  }): Promise<MaterialPackageResult | undefined> {
    const materialDirectory = await this.resolveMaterialDirectory(params.materialType, params.materialName);
    if (!materialDirectory) {
      return undefined;
    }
    const primaryMtlxPath = await this.primaryMtlxPath(materialDirectory);
    if (!primaryMtlxPath) {
      return undefined;
    }
    return createMaterialPackage({
      materialsRoot: this.materialsRoot,
      materialDirectory,
      primaryMtlxPath,
      metadata: params.metadata,
    });
  }
}
