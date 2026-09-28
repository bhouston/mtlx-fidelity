import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rendererReportPath, type RenderReport, type RenderResultReport } from '@mtlx-fidelity/samples';
import { readRendererReportJson, summarizeRendererReport } from './renderer-report-io.js';

describe('readRendererReportJson', () => {
  it('parses valid render result reports', async () => {
    const materialDirectory = await mkdtemp(path.join(tmpdir(), 'renderer-report-'));
    const reportPath = rendererReportPath(materialDirectory, 'fake');
    const report: RenderResultReport = {
      rendererName: 'fake',
      status: 'failed',
      error: {
        name: 'Error',
        message: 'Renderer failed',
      },
      validationIssues: [
        {
          level: 'warning',
          location: 'materialx/node:test',
          message: 'Minor warning',
        },
      ],
      logs: [
        {
          level: 'error',
          source: 'renderer',
          message: 'shader compile failed',
        },
      ],
    };

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    await expect(readRendererReportJson(materialDirectory, 'fake')).resolves.toEqual(report);
  });

  it('returns undefined for schema-invalid reports', async () => {
    const materialDirectory = await mkdtemp(path.join(tmpdir(), 'renderer-report-invalid-'));
    const reportPath = rendererReportPath(materialDirectory, 'fake');
    await writeFile(
      reportPath,
      `${JSON.stringify({
        rendererName: 'fake',
        status: 'failed',
        error: null,
        logs: [
          {
            level: 'fatal',
            source: 'renderer',
            message: 'invalid level',
          },
        ],
      })}\n`,
      'utf8',
    );

    await expect(readRendererReportJson(materialDirectory, 'fake')).resolves.toBeUndefined();
  });
});

describe('summarizeRendererReport', () => {
  it('marks reports with non-error logs as warning severity', () => {
    const report: RenderResultReport = {
      rendererName: 'fake',
      status: 'success',
      error: null,
      logs: [
        {
          level: 'warning',
          source: 'renderer',
          message: 'Fallback shader path used',
        },
      ],
    };

    expect(summarizeRendererReport(report)).toEqual({
      severity: 'warning',
      hasMessages: true,
      hasErrorMessages: false,
      hasException: false,
    });
  });

  it('marks reports with error logs or exceptions as error severity', () => {
    const report: RenderReport = {
      rendererName: 'fake',
      status: 'failed',
      error: {
        name: 'Error',
        message: 'Renderer crashed',
      },
      logs: [
        {
          level: 'error',
          source: 'renderer',
          message: 'shader compile failed',
        },
      ],
    };

    expect(summarizeRendererReport(report)).toEqual({
      severity: 'error',
      hasMessages: true,
      hasErrorMessages: true,
      hasException: true,
    });
  });
});
