import path from 'node:path';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import {
  getMaterialsRoot,
  getSamplesRootFromSubmodules,
  getViewerAssetsRoot,
  materialMatchesSelector,
  RenderLogEntrySchema,
  RenderResultReportSchema,
  type RenderLogEntry,
  type RenderReportIssue,
} from '@material-fidelity/samples';
import { findMtlxMaterialFiles } from '@material-fidelity/samples-io';
import { assertRenderIsNotEmpty, calculateImageNormalizedRgbRms } from './image-empty-check.js';
import {
  formatFatalValidationIssues,
  validateMaterial,
  writeValidationWarnings,
  type PreflightIssue,
  type PreflightResult,
} from './material-validation.js';
import type { CreateReferencesOptions, CreateReferencesResult, FidelityRenderer, RenderFailure } from './types.js';

const VIEWER_HDR_FILENAME = 'san_giuseppe_bridge_2k.hdr';
const VIEWER_MODEL_FILENAME = 'ShaderBall.glb';
const DEFAULT_BACKGROUND_COLOR = '0,0,0';
const RENDER_REPLACE_RMS_THRESHOLD = 0.0002;

function createOutputPath(materialPath: string, rendererName: string): string {
  return path.join(path.dirname(materialPath), `${rendererName}.png`);
}

function createTempOutputPath(materialPath: string, rendererName: string): string {
  return path.join(path.dirname(materialPath), `${rendererName}-temp.png`);
}

function toLegacyWebpPath(outputPngPath: string): string {
  const parsed = path.parse(outputPngPath);
  return path.join(parsed.dir, `${parsed.name}.webp`);
}

function toJsonPath(outputPngPath: string): string {
  const parsedPath = path.parse(outputPngPath);
  return path.join(parsedPath.dir, `${parsedPath.name}.json`);
}

interface RenderResultReportOptions {
  rendererName: string;
  materialPath: string;
  outputPngPath: string;
  success: boolean;
  error?: Error;
  validationIssues?: PreflightIssue[];
  logs?: RenderLogEntry[];
}

const NOISY_LOG_MESSAGE_SUBSTRINGS = [
  'Download the React DevTools for a better development experience',
  'Wrote frame to disk:',
];
const MATERIALXVIEW_IRRADIANCE_WARNING_PATTERN = /Image file not found: .*\/irradiance\/san_giuseppe_bridge_2k\.hdr$/;
const BLENDER_VERSION_BANNER_PATTERN = /^Blender \d+\.\d+\.\d+(?: [^(]+)? \(hash [^)]+ built [^)]+\)$/;

function isNoisyLogMessage(message: string): boolean {
  return (
    NOISY_LOG_MESSAGE_SUBSTRINGS.some((substring) => message.includes(substring)) ||
    MATERIALXVIEW_IRRADIANCE_WARNING_PATTERN.test(message) ||
    BLENDER_VERSION_BANNER_PATTERN.test(message)
  );
}

function filterReportableLogs(logs: RenderLogEntry[]): RenderLogEntry[] {
  return logs.filter((entry) => entry.level !== 'debug' && !isNoisyLogMessage(entry.message));
}

function readRendererLogs(value: unknown): RenderLogEntry[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const candidate = value as { rendererLogs?: unknown };
  if (!Array.isArray(candidate.rendererLogs)) {
    return [];
  }
  return filterReportableLogs(
    candidate.rendererLogs.filter((entry): entry is RenderLogEntry => RenderLogEntrySchema.safeParse(entry).success),
  );
}

function normalizeRenderLogs(logs: RenderLogEntry[]): RenderLogEntry[] {
  return filterReportableLogs(logs);
}

function toRenderReportIssue(issue: PreflightIssue): RenderReportIssue {
  return {
    level: issue.level,
    location: issue.location,
    message: issue.message,
  };
}

async function writeRenderResultReport(options: RenderResultReportOptions): Promise<void> {
  const reportPath = toJsonPath(options.outputPngPath);
  const report = RenderResultReportSchema.parse({
    rendererName: options.rendererName,
    status: options.success ? 'success' : 'failed',
    error: options.error
      ? {
          name: options.error.name,
          message: options.error.message,
          stack: options.error.stack,
        }
      : null,
    validationIssues: options.validationIssues?.map(toRenderReportIssue),
    logs: options.logs ?? [],
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createReferences(options: CreateReferencesOptions): Promise<CreateReferencesResult> {
  const samplesRoot = getSamplesRootFromSubmodules(options.submodulesRoot);
  const materialsRoot = getMaterialsRoot(samplesRoot);
  const viewerRoot = getViewerAssetsRoot(samplesRoot);

  try {
    await access(samplesRoot);
  } catch {
    throw new Error(`Missing required material-samples directory at ${samplesRoot}.`);
  }

  try {
    await access(materialsRoot);
  } catch {
    throw new Error(`Missing required materials directory at ${materialsRoot}.`);
  }

  try {
    await access(viewerRoot);
  } catch {
    throw new Error(`Missing required viewer directory at ${viewerRoot}.`);
  }

  const materialFiles = await findMtlxMaterialFiles(materialsRoot);
  if (materialFiles.length === 0) {
    throw new Error(`No .mtlx files found under ${materialsRoot}.`);
  }
  const materialSelectors = [
    ...new Set((options.materialSelectors ?? []).map((selector) => selector.trim()).filter(Boolean)),
  ];
  const selectedMaterialFiles =
    materialSelectors.length > 0
      ? materialFiles.filter((materialPath) =>
          materialSelectors.some((selector) => materialMatchesSelector(materialPath, selector)),
        )
      : materialFiles;
  if (selectedMaterialFiles.length === 0) {
    throw new Error(`No .mtlx files matched --materials "${materialSelectors.join(', ')}".`);
  }
  await options.onPlan?.({ materialPaths: selectedMaterialFiles });

  const rendererMap = new Map<string, FidelityRenderer>();
  for (const renderer of options.renderers) {
    if (rendererMap.has(renderer.name)) {
      throw new Error(`Duplicate renderer name detected: "${renderer.name}".`);
    }
    rendererMap.set(renderer.name, renderer);
  }

  const normalizedRequestedRenderers = [
    ...new Set((options.rendererNames ?? []).map((name) => name.trim()).filter(Boolean)),
  ];
  const selectedRendererNames =
    normalizedRequestedRenderers.length > 0 ? normalizedRequestedRenderers : [...rendererMap.keys()];
  if (selectedRendererNames.length === 0) {
    const available = [...rendererMap.keys()].toSorted().join(', ');
    throw new Error(`No renderers are available. Available renderers: ${available || '(none)'}.`);
  }
  const missingRendererNames = selectedRendererNames.filter((rendererName) => !rendererMap.has(rendererName));
  if (missingRendererNames.length > 0) {
    const available = [...rendererMap.keys()].toSorted().join(', ');
    throw new Error(
      `Renderer(s) "${missingRendererNames.join(', ')}" not found. Available renderers: ${available || '(none)'}.`,
    );
  }
  const selectedRenderers = selectedRendererNames.map(
    (rendererName) => rendererMap.get(rendererName) as FidelityRenderer,
  );
  const selectedRenderQueue = selectedMaterialFiles.flatMap((materialPath) =>
    selectedRenderers.map((renderer) => ({ materialPath, renderer })),
  );
  const renderQueue = options.skipExisting
    ? (
        await Promise.all(
          selectedRenderQueue.map(async (entry) => ({
            ...entry,
            outputExists: await fileExists(createOutputPath(entry.materialPath, entry.renderer.name)),
          })),
        )
      )
        .filter((entry) => !entry.outputExists)
        .map(({ materialPath, renderer }) => ({ materialPath, renderer }))
    : selectedRenderQueue;
  if (renderQueue.length === 0) {
    return {
      rendererNames: selectedRenderers.map((renderer) => renderer.name),
      total: 0,
      attempted: 0,
      rendered: 0,
      failures: [],
      stopped: false,
    };
  }
  const rendererNamesInQueue = new Set(renderQueue.map((entry) => entry.renderer.name));
  const renderersToRun = selectedRenderers.filter((renderer) => rendererNamesInQueue.has(renderer.name));

  const hdrPath = path.join(viewerRoot, VIEWER_HDR_FILENAME);
  const modelPath = path.join(viewerRoot, VIEWER_MODEL_FILENAME);
  const missingViewerAssets: string[] = [];

  try {
    await access(hdrPath);
  } catch {
    missingViewerAssets.push(VIEWER_HDR_FILENAME);
  }

  try {
    await access(modelPath);
  } catch {
    missingViewerAssets.push(VIEWER_MODEL_FILENAME);
  }
  if (missingViewerAssets.length > 0) {
    throw new Error(`Missing required viewer assets under ${viewerRoot}: ${missingViewerAssets.join(', ')}.`);
  }

  const failedRendererChecks: string[] = [];
  for (const renderer of renderersToRun) {
    const checkResult = await renderer.checkPrerequisites();
    if (!checkResult.success) {
      failedRendererChecks.push(
        `${renderer.name}: ${checkResult.message?.trim() || 'Renderer prerequisites are not satisfied.'}`,
      );
    }
    try {
      await access(renderer.emptyReferenceImagePath);
    } catch {
      failedRendererChecks.push(
        `${renderer.name}: Missing empty reference image at ${renderer.emptyReferenceImagePath}.`,
      );
    }
  }
  if (failedRendererChecks.length > 0) {
    throw new Error(`Renderer prerequisites are not met:\n- ${failedRendererChecks.join('\n- ')}`);
  }
  const failures: RenderFailure[] = [];
  let started = 0;
  let completed = 0;
  let attempted = 0;
  let stopped = false;
  const shouldStop = (): boolean => options.shouldStop?.() === true;
  const materialValidationCache = new Map<string, Promise<PreflightResult>>();
  const getMaterialValidation = (materialPath: string): Promise<PreflightResult> => {
    const existing = materialValidationCache.get(materialPath);
    if (existing) {
      return existing;
    }

    const validationPromise = validateMaterial(materialPath).then((result) => {
      if (result.warningIssues.length > 0) {
        writeValidationWarnings(result.warningIssues);
      }
      return result;
    });
    materialValidationCache.set(materialPath, validationPromise);
    return validationPromise;
  };
  const startedRenderers: FidelityRenderer[] = [];
  let renderPipelineError: Error | undefined;
  let shutdownError: Error | undefined;
  try {
    for (const renderer of renderersToRun) {
      await renderer.start({
        modelPath,
        environmentHdrPath: hdrPath,
        backgroundColor: DEFAULT_BACKGROUND_COLOR,
      });
      startedRenderers.push(renderer);
    }

    const limit = pLimit(Math.max(1, options.concurrency));
    await Promise.all(
      renderQueue.map(({ materialPath, renderer }) =>
        limit(async () => {
          if (shouldStop()) {
            stopped = true;
            return;
          }

          const outputPngPath = createOutputPath(materialPath, renderer.name);
          started += 1;
          await options.onProgress?.({
            phase: 'start',
            rendererName: renderer.name,
            materialPath,
            outputPngPath,
            total: renderQueue.length,
            started,
            completed,
          });
          await mkdir(path.dirname(outputPngPath), { recursive: true });

          let renderError: Error | undefined;
          let validationIssues: PreflightIssue[] | undefined;
          let logs: RenderLogEntry[] = [];
          const startedAt = Date.now();
          const outputTempPngPath = createTempOutputPath(materialPath, renderer.name);
          const legacyWebpPath = toLegacyWebpPath(outputPngPath);
          try {
            const validationResult = await getMaterialValidation(materialPath);
            if (validationResult.fatalIssues.length > 0) {
              validationIssues = validationResult.fatalIssues;
              throw new Error(formatFatalValidationIssues(materialPath, validationResult.fatalIssues));
            }
            const renderResult = await renderer.generateImage({
              mtlxPath: materialPath,
              outputPngPath: outputTempPngPath,
            });
            logs = normalizeRenderLogs([...renderResult.logs]);
            await rm(legacyWebpPath, { force: true });
            await assertRenderIsNotEmpty(outputTempPngPath, renderer.emptyReferenceImagePath);
            const hasExistingCanonical = await fileExists(outputPngPath);
            if (!hasExistingCanonical) {
              await rename(outputTempPngPath, outputPngPath);
            } else {
              const normalizedRms = await calculateImageNormalizedRgbRms(outputTempPngPath, outputPngPath, {
                treatDimensionMismatchAsMaxDifference: true,
              });
              if (normalizedRms > RENDER_REPLACE_RMS_THRESHOLD) {
                await rm(outputPngPath, { force: true });
                await rename(outputTempPngPath, outputPngPath);
              } else {
                await rm(outputTempPngPath, { force: true });
              }
            }
          } catch (error) {
            renderError = error instanceof Error ? error : new Error(String(error));
            logs = normalizeRenderLogs([...logs, ...readRendererLogs(error)]);
          }

          if (renderError) {
            await rm(outputTempPngPath, { force: true });
            await rm(outputPngPath, { force: true });
          }

          const completedAt = Date.now();
          try {
            await writeRenderResultReport({
              rendererName: renderer.name,
              materialPath,
              outputPngPath,
              success: !renderError,
              error: renderError,
              validationIssues,
              logs,
            });
          } catch (reportError) {
            renderError ??= reportError instanceof Error ? reportError : new Error(String(reportError));
          }

          if (renderError) {
            failures.push({ rendererName: renderer.name, materialPath, outputPngPath, error: renderError, logs });
          }
          attempted += 1;
          completed += 1;

          await options.onProgress?.({
            phase: 'finish',
            rendererName: renderer.name,
            materialPath,
            outputPngPath,
            total: renderQueue.length,
            started,
            completed,
            success: !renderError,
            durationMs: Math.max(0, completedAt - startedAt),
            error: renderError,
            logs,
          });
        }),
      ),
    );
  } catch (error) {
    renderPipelineError = error instanceof Error ? error : new Error(String(error));
  } finally {
    for (const renderer of startedRenderers.toReversed()) {
      try {
        await renderer.shutdown();
      } catch (error) {
        shutdownError ??= error instanceof Error ? error : new Error(String(error));
      }
    }
  }
  if (shutdownError) {
    throw shutdownError;
  }
  if (renderPipelineError) {
    throw renderPipelineError;
  }

  return {
    rendererNames: selectedRenderers.map((renderer) => renderer.name),
    total: renderQueue.length,
    attempted,
    rendered: attempted - failures.length,
    failures,
    stopped,
  };
}
