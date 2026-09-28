import { readFile } from 'node:fs/promises';
import {
  parseRenderReport,
  rendererReportPath,
  type RenderReport,
  type RendererReportSummary,
} from '@mtlx-fidelity/samples';
import { pathExists } from './fs-utils.js';

export function summarizeRendererReport(report: RenderReport): RendererReportSummary {
  if (report.status === 'validation_failed') {
    const hasErrorIssues = report.issues.some((issue) => issue.level === 'error');
    return {
      severity: hasErrorIssues ? 'error' : report.issues.length > 0 ? 'warning' : 'none',
      hasMessages: report.issues.length > 0,
      hasErrorMessages: hasErrorIssues,
      hasException: false,
    };
  }

  const hasLogs = report.logs.length > 0;
  const hasErrorLogs = report.logs.some((entry) => entry.level === 'error');
  const hasException = report.error !== null;

  return {
    severity: hasErrorLogs || hasException ? 'error' : hasLogs ? 'warning' : 'none',
    hasMessages: hasLogs,
    hasErrorMessages: hasErrorLogs,
    hasException,
  };
}

export async function readRendererReportJson(
  materialDirectory: string,
  rendererName: string,
): Promise<RenderReport | undefined> {
  const reportPath = rendererReportPath(materialDirectory, rendererName);
  if (!(await pathExists(reportPath))) {
    return undefined;
  }
  try {
    return parseRenderReport(JSON.parse(await readFile(reportPath, 'utf8')) as unknown);
  } catch {
    return undefined;
  }
}
