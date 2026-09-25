import path from 'node:path';
import { availableParallelism } from 'node:os';
import { createElement, useEffect, useMemo, useState } from 'react';
import { render, useApp } from 'ink';
import { calculateMetrics } from '@material-fidelity/core';
import type { CalculateMetricsProgressEvent, CalculateMetricsResult, FidelityRenderer } from '@material-fidelity/core';
import {
  createEeveeNodesRenderer as createBlenderEeveeNodesRenderer,
  createNodesRenderer as createBlenderNodesRenderer,
  createRenderer as createBlenderRenderer,
} from '@material-fidelity/renderer-blender';
import {
  createGlslRenderer as createMaterialXGlslRenderer,
  createMetalRenderer as createMaterialXMetalRenderer,
  createOslRenderer as createMaterialXOslRenderer,
} from '@material-fidelity/renderer-materialxview';
import {
  createCurrentRenderer as createThreeJsCurrentRenderer,
  createRenderer as createThreeJsNewRenderer,
} from '@material-fidelity/renderer-threejs';
import { humanizeTime } from 'humanize-units';
import { defineCommand } from 'yargs-file-commands';
import { resolveRendererNames } from '../renderer-selectors.js';
import { ProgressDisplay, appendProgressLogLine, upsertProgressLogLine, type ProgressLogLine } from '../progress-ui.js';

function inferRepoRoot(invocationCwd: string): string {
  if (path.basename(invocationCwd) === 'cli' && path.basename(path.dirname(invocationCwd)) === 'packages') {
    return path.dirname(path.dirname(invocationCwd));
  }

  return invocationCwd;
}

function resolveSubmodulesRoot(invocationCwd: string): string {
  const repoRoot = inferRepoRoot(invocationCwd);
  return path.join(repoRoot, 'submodules');
}

function getDefaultConcurrency(): number {
  return Math.max(1, availableParallelism());
}

function formatMaterialLabel(materialPath: string, materialsRoot: string): string {
  const materialDirectory = path.dirname(materialPath);
  const relativePath = path.relative(materialsRoot, materialDirectory);
  return relativePath.length > 0 ? relativePath : materialDirectory;
}

function normalizeStringList(rawValues: unknown): string[] {
  const values = rawValues == null ? [] : Array.isArray(rawValues) ? rawValues : [rawValues];
  return [
    ...new Set(
      values
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function createBuiltInRenderers(submodulesRoot: string): FidelityRenderer[] {
  return [
    createBlenderRenderer({ submodulesRoot }),
    createBlenderNodesRenderer({ submodulesRoot }),
    createBlenderEeveeNodesRenderer({ submodulesRoot }),
    createMaterialXGlslRenderer(),
    createMaterialXMetalRenderer(),
    createMaterialXOslRenderer(),
    createThreeJsNewRenderer({ submodulesRoot }),
    createThreeJsCurrentRenderer({ submodulesRoot }),
  ];
}

function formatMetricsResult(result: CalculateMetricsResult, elapsedSeconds: number): string {
  const elapsedFormatted = humanizeTime(elapsedSeconds, { unitSeparator: ' ' });
  return `Updated PSNR for ${result.written}/${result.total} materials with renderers ${result.rendererNames.map((name) => `"${name}"`).join(', ')}. Missing references: ${result.skippedMissingReference}. Failures: ${result.failures.length}. Time: ${elapsedFormatted}\n`;
}

interface InkCalculateMetricsAppProps {
  args: {
    submodulesRoot: string;
    rendererNames: string[];
    materialSelectors: string[];
    concurrency: number;
  };
  onComplete: (result: CalculateMetricsResult) => void;
  onError: (error: Error) => void;
}

function InkCalculateMetricsApp({ args, onComplete, onError }: InkCalculateMetricsAppProps) {
  const { exit } = useApp();
  const [total, setTotal] = useState(0);
  const [started, setStarted] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [metricsLogs, setMetricsLogs] = useState<ProgressLogLine[]>([]);
  const [statusLine, setStatusLine] = useState('Preparing PSNR plan...');

  useEffect(() => {
    let active = true;
    const materialsRoot = path.join(args.submodulesRoot, 'material-samples', 'materials');

    const applyProgress = (event: CalculateMetricsProgressEvent) => {
      if (!active) {
        return;
      }

      const label = formatMaterialLabel(event.materialPath, materialsRoot);
      const logEntryKey = event.materialPath;
      setTotal(event.total);
      setStarted(event.started);
      setCompleted(event.completed);

      if (event.phase === 'start') {
        setStatusLine(`Calculating PSNR for ${label}`);
        setMetricsLogs((previous) =>
          appendProgressLogLine(previous, {
            key: logEntryKey,
            label: `${label} | psnr`,
            status: 'IN PROGRESS',
          }),
        );
        return;
      }

      if (event.success === false) {
        setFailed((count) => count + 1);
      }
      setMetricsLogs((previous) =>
        upsertProgressLogLine(previous, {
          key: logEntryKey,
          label: `${label} | psnr`,
          status: event.success ? 'SUCCESS' : 'FAILED',
          errorMessage: event.success ? undefined : (event.error?.message ?? 'Unknown error'),
        }),
      );
    };

    void calculateMetrics({
      ...args,
      onPlan: (event) => {
        if (!active) {
          return;
        }
        setTotal(event.materialPaths.length);
        setStatusLine(`Queued ${event.materialPaths.length} materials for PSNR`);
      },
      onProgress: applyProgress,
    })
      .then((result) => {
        if (!active) {
          return;
        }
        onComplete(result);
        exit();
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        onError(error instanceof Error ? error : new Error(String(error)));
        exit();
      });

    return () => {
      active = false;
    };
  }, [args, exit, onComplete, onError]);

  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
  const active = Math.max(0, started - completed);
  const effectiveCompleted = Math.min(total, completed + active * 0.5);
  const etaSeconds = useMemo(() => {
    if (effectiveCompleted < 1 || total <= effectiveCompleted) {
      return null;
    }
    const secondsPerMaterial = elapsedSeconds / effectiveCompleted;
    return Math.max(0, secondsPerMaterial * (total - effectiveCompleted));
  }, [effectiveCompleted, elapsedSeconds, total]);

  return createElement(ProgressDisplay, {
    title: `Renderers: ${args.rendererNames.join(', ')}`,
    statusLine,
    logs: metricsLogs,
    completed,
    total,
    active,
    failed,
    elapsedText: humanizeTime(elapsedSeconds),
    etaText: etaSeconds == null ? '?' : humanizeTime(etaSeconds),
  });
}

async function runCalculateMetricsWithInk(args: InkCalculateMetricsAppProps['args']): Promise<CalculateMetricsResult> {
  return new Promise<CalculateMetricsResult>((resolve, reject) => {
    const app = render(
      createElement(InkCalculateMetricsApp, {
        args,
        onComplete: resolve,
        onError: reject,
      }),
    );

    void app.waitUntilExit();
  });
}

export const command = defineCommand({
  command: 'metrics',
  describe: 'Calculate PSNR for rendered PNG images.',
  builder: (yargs) =>
    yargs
      .option('renderers', {
        type: 'array',
        describe:
          'Renderer selectors to compare. Supports repeated values, comma-separated lists, and substring matches.',
      })
      .option('materials', {
        type: 'array',
        describe:
          'Material selectors matched against material directory names. Supports repeated values, comma-separated values, or regex (`re:...` or `/.../flags`).',
      })
      .option('concurrency', {
        type: 'number',
        default: getDefaultConcurrency(),
        describe: 'Number of materials to process in parallel. Defaults to the recommended available parallelism.',
      })
      .option('filter', {
        type: 'string',
        describe: 'Deprecated alias for --materials with a single substring selector.',
      }),
  handler: async (argv) => {
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    const submodulesRoot = resolveSubmodulesRoot(invocationCwd);
    const renderers = createBuiltInRenderers(submodulesRoot);
    const materialSelectors = normalizeStringList(argv.materials);
    if (argv.filter && argv.filter.trim().length > 0) {
      materialSelectors.push(argv.filter);
    }

    const startedAt = Date.now();
    const rendererNames = resolveRendererNames(renderers, normalizeStringList(argv.renderers), { defaultToAll: true });
    const commandArgs = {
      submodulesRoot,
      rendererNames,
      materialSelectors: [...new Set(materialSelectors)],
      concurrency: Math.max(1, argv.concurrency ?? getDefaultConcurrency()),
    };
    const isInteractive = process.stdout.isTTY && !process.env.CI;
    const result = isInteractive
      ? await runCalculateMetricsWithInk(commandArgs)
      : await calculateMetrics({
          ...commandArgs,
          onProgress: (event) => {
            if (event.phase !== 'finish') {
              return;
            }
            const status = event.success ? 'SUCCESS' : 'FAILED';
            process.stdout.write(
              `${path.relative(process.cwd(), event.metricsPath)} | ${status} ${event.completed}/${event.total}\n`,
            );
          },
        });
    const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
    process.stdout.write(formatMetricsResult(result, elapsedSeconds));

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        process.stderr.write(`FAILED ${failure.materialPath}: ${failure.error.message}\n`);
      }
      process.exitCode = 1;
    }
  },
});
