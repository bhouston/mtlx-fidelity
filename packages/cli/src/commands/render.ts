import path from 'node:path';
import { availableParallelism } from 'node:os';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { render, useApp, useInput } from 'ink';
import { createReferences } from '@material-fidelity/core';
import type { CreateReferencesProgressEvent, CreateReferencesResult, FidelityRenderer } from '@material-fidelity/core';
import type { RenderLogEntry } from '@material-fidelity/samples';
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

function formatMaterialLabel(materialPath: string, materialsRoot: string): string {
  const materialDirectory = path.dirname(materialPath);
  const relativePath = path.relative(materialsRoot, materialDirectory);
  return relativePath.length > 0 ? relativePath : materialDirectory;
}

function normalizeRendererNames(rawRenderers: unknown): string[] {
  const rendererValues = rawRenderers == null ? [] : Array.isArray(rawRenderers) ? rawRenderers : [rawRenderers];
  return [
    ...new Set(
      rendererValues
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
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

function renderDiagnosticLogs(logs: RenderLogEntry[] | undefined): string[] {
  if (!logs || logs.length === 0) {
    return [];
  }
  return logs.map((entry) => `  [${entry.source}:${entry.level}] ${entry.message}`);
}

interface InkCreateReferencesAppProps {
  args: {
    renderers: FidelityRenderer[];
    submodulesRoot: string;
    rendererNames: string[];
    concurrency: number;
    materialSelectors: string[];
    skipExisting: boolean;
    filter?: string;
  };
  onComplete: (result: CreateReferencesResult) => void;
  onError: (error: Error) => void;
}

function InkCreateReferencesApp({ args, onComplete, onError }: InkCreateReferencesAppProps) {
  const { exit } = useApp();
  const [total, setTotal] = useState(0);
  const [started, setStarted] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [renderLogs, setRenderLogs] = useState<ProgressLogLine[]>([]);
  const [stopping, setStopping] = useState(false);
  const [statusLine, setStatusLine] = useState('Preparing render plan...');
  const stopRequestedRef = useRef(false);

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === 'c') {
      stopRequestedRef.current = true;
      setStopping(true);
      setStatusLine('Stopping after in-flight renders complete...');
    }
  });

  useEffect(() => {
    let active = true;
    const materialsRoot = path.join(args.submodulesRoot, 'material-samples', 'materials');

    const applyProgress = (event: CreateReferencesProgressEvent) => {
      if (!active) {
        return;
      }

      if (event.phase === 'start') {
        const label = formatMaterialLabel(event.materialPath, materialsRoot);
        const logEntryKey = `${event.rendererName}:${event.materialPath}`;
        setTotal(event.total);
        setStarted(event.started);
        setCompleted(event.completed);
        setStatusLine(`Rendering ${event.rendererName} | ${label}`);
        setRenderLogs((previous) =>
          appendProgressLogLine(previous, {
            key: logEntryKey,
            label: `${label} | ${event.rendererName}`,
            status: 'IN PROGRESS',
          }),
        );
        return;
      }

      const elapsed = humanizeTime((event.durationMs ?? 0) / 1000);
      const label = formatMaterialLabel(event.materialPath, materialsRoot);
      setTotal(event.total);
      setCompleted(event.completed);
      if (event.success === false) {
        setFailed((count) => count + 1);
      }
      setRenderLogs((previous) =>
        upsertProgressLogLine(previous, {
          key: `${event.rendererName}:${event.materialPath}`,
          label: `${label} | ${event.rendererName}`,
          status: event.success ? 'SUCCESS' : 'FAILED',
          durationText: elapsed,
          errorMessage: event.success ? undefined : (event.error?.message ?? 'Unknown error'),
        }),
      );
    };

    void createReferences({
      renderers: args.renderers,
      submodulesRoot: args.submodulesRoot,
      rendererNames: args.rendererNames,
      concurrency: args.concurrency,
      materialSelectors: args.materialSelectors,
      skipExisting: args.skipExisting,
      filter: args.filter,
      shouldStop: () => stopRequestedRef.current,
      onPlan: (event) => {
        if (!active) {
          return;
        }
        setTotal(event.materialPaths.length);
        setStatusLine(`Queued ${event.materialPaths.length} materials`);
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
    const secondsPerRender = elapsedSeconds / effectiveCompleted;
    return Math.max(0, secondsPerRender * (total - effectiveCompleted));
  }, [effectiveCompleted, elapsedSeconds, total]);

  return createElement(ProgressDisplay, {
    title: `Renderers: ${args.rendererNames.length > 0 ? args.rendererNames.join(', ') : 'all (built-in)'}`,
    statusLine,
    logs: renderLogs,
    completed,
    total,
    active,
    failed,
    elapsedText: humanizeTime(elapsedSeconds),
    etaText: etaSeconds == null ? '?' : humanizeTime(etaSeconds),
    footerTone: stopping ? 'yellow' : 'gray',
    footerSuffix: 'Ctrl-C to stop',
  });
}

async function runCreateReferencesWithInk(args: InkCreateReferencesAppProps['args']): Promise<CreateReferencesResult> {
  return new Promise<CreateReferencesResult>((resolve, reject) => {
    const app = render(
      createElement(InkCreateReferencesApp, {
        args,
        onComplete: resolve,
        onError: reject,
      }),
    );

    void app.waitUntilExit();
  });
}

export const command = defineCommand({
  command: 'render',
  describe: 'Render reference PNG images for each MaterialX sample material.',
  builder: (yargs) =>
    yargs
      .option('renderers', {
        type: 'array',
        describe: 'Renderer selectors to use. Supports repeated values, comma-separated lists, and substring matches.',
      })
      .option('concurrency', {
        type: 'number',
        default: availableParallelism(),
        describe: 'Number of materials to render in parallel. Defaults to the recommended available parallelism.',
      })
      .option('materials', {
        type: 'array',
        describe:
          'Material selectors matched against material directory names. Supports repeated values, comma-separated values, or regex (`re:...` or `/.../flags`).',
      })
      .option('skip-existing', {
        type: 'boolean',
        default: false,
        describe: 'Only render outputs whose renderer/sample PNG does not already exist.',
      })
      .option('filter', {
        type: 'string',
        describe: 'Deprecated alias for --materials with a single substring selector.',
      }),
  handler: async (argv) => {
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    const submodulesRoot = resolveSubmodulesRoot(invocationCwd);
    const renderers: FidelityRenderer[] = [
      createBlenderRenderer({ submodulesRoot }),
      createBlenderNodesRenderer({ submodulesRoot }),
      createBlenderEeveeNodesRenderer({ submodulesRoot }),
      createMaterialXGlslRenderer(),
      createMaterialXMetalRenderer(),
      createMaterialXOslRenderer(),
      createThreeJsNewRenderer({ submodulesRoot }),
      createThreeJsCurrentRenderer({ submodulesRoot }),
    ];
    const startedAt = Date.now();
    const materialSelectors = normalizeStringList(argv.materials);
    if (argv.filter && argv.filter.trim().length > 0) {
      materialSelectors.push(argv.filter);
    }
    const commandArgs = {
      renderers,
      submodulesRoot,
      rendererNames: resolveRendererNames(renderers, normalizeRendererNames(argv.renderers), { defaultToAll: false }),
      concurrency: Math.max(1, argv.concurrency ?? availableParallelism()),
      materialSelectors: [...new Set(materialSelectors)],
      skipExisting: argv.skipExisting ?? false,
      filter: argv.filter,
    };
    const materialsRoot = path.join(submodulesRoot, 'material-samples', 'materials');
    const isInteractive = process.stdout.isTTY && !process.env.CI;
    const result = isInteractive
      ? await runCreateReferencesWithInk(commandArgs)
      : await createReferences({
          ...commandArgs,
          onProgress: (event) => {
            if (event.phase !== 'finish') {
              return;
            }
            const elapsed = humanizeTime((event.durationMs ?? 0) / 1000);
            const status = event.success ? 'SUCCESS' : 'FAILED';
            const materialLabel = formatMaterialLabel(event.materialPath, materialsRoot);
            process.stdout.write(
              `${event.rendererName} | ${materialLabel} | ${status} (${elapsed}) ${event.completed}/${event.total}\n`,
            );
            if (!event.success) {
              for (const line of renderDiagnosticLogs(event.logs)) {
                process.stderr.write(`${line}\n`);
              }
            }
          },
        });
    const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
    const elapsedFormatted = humanizeTime(elapsedSeconds);

    process.stdout.write(
      `Rendered ${result.rendered}/${result.total} images with renderers ${result.rendererNames.map((name) => `"${name}"`).join(', ')}. Failures: ${result.failures.length}. Time: ${elapsedFormatted}${result.stopped ? ' (stopped early)' : ''}\n`,
    );

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        process.stderr.write(`FAILED ${failure.rendererName} | ${failure.materialPath}: ${failure.error.message}\n`);
        for (const line of renderDiagnosticLogs(failure.logs)) {
          process.stderr.write(`${line}\n`);
        }
      }
      process.exitCode = 1;
    }
  },
});
