import { useSuspenseQuery } from '@tanstack/react-query';
import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createServerFn, useServerFn } from '@tanstack/react-start';
import {
  parseRenderReport,
  type RenderReport,
  type RenderReportError,
  type RenderReportIssue,
} from '@mtlx-fidelity/samples';
import { RenderLogViewer } from '#/components/RenderLogViewer';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog';

export interface ActiveReportState {
  materialName: string;
  rendererName: string;
  reportUrl: string;
}

function parseReportUrl(reportUrl: string): { materialType: string; materialName: string; rendererName: string } {
  const { pathname } = new URL(reportUrl, 'http://localhost');
  const pathSegments = pathname.split('/').filter((segment) => segment.length > 0);

  if (pathSegments.length !== 5 || pathSegments[0] !== 'api' || pathSegments[1] !== 'reference-report') {
    throw new Error('Invalid render report URL.');
  }

  return {
    materialType: decodeURIComponent(pathSegments[2] ?? ''),
    materialName: decodeURIComponent(pathSegments[3] ?? ''),
    rendererName: decodeURIComponent(pathSegments[4] ?? ''),
  };
}

const getRenderReport = createServerFn({
  method: 'GET',
})
  .inputValidator((data: { reportUrl: string }) => data)
  .handler(async ({ data }) => {
    const { readFile } = await import('node:fs/promises');
    const { rendererReportPath } = await import('@mtlx-fidelity/samples');
    const { pathExists, resolveMaterialDirectory, resolveSampleRoots } = await import('@mtlx-fidelity/samples-io');

    const { materialType, materialName, rendererName } = parseReportUrl(data.reportUrl);
    const roots = resolveSampleRoots();
    const materialDirectory = await resolveMaterialDirectory(roots.materialsRoot, materialType, materialName);
    if (!materialDirectory) {
      throw new Error('Render report not found.');
    }

    const filePath = rendererReportPath(materialDirectory, rendererName);
    if (!(await pathExists(filePath))) {
      throw new Error('Render report not found.');
    }

    return parseRenderReport(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  });

function getRenderReportError(report: RenderReport): RenderReportError | null {
  return report.status === 'validation_failed' ? null : report.error;
}

function getRenderReportIssues(report: RenderReport): RenderReportIssue[] {
  return report.status === 'validation_failed' ? report.issues : (report.validationIssues ?? []);
}

function getRenderReportLogs(report: RenderReport) {
  return report.status === 'validation_failed' ? undefined : report.logs;
}

interface RenderReportDialogProps {
  report: ActiveReportState;
  onClose: () => void;
}

interface RenderReportErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface RenderReportErrorBoundaryState {
  error: Error | null;
}

class RenderReportErrorBoundary extends Component<RenderReportErrorBoundaryProps, RenderReportErrorBoundaryState> {
  declare state: RenderReportErrorBoundaryState;

  constructor(props: RenderReportErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): RenderReportErrorBoundaryState {
    return { error };
  }
  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }

    return this.props.children;
  }
}

function RenderReportDialogContent({ reportUrl }: { reportUrl: string }) {
  const fetchRenderReport = useServerFn(getRenderReport);
  const { data } = useSuspenseQuery({
    queryKey: ['render-report', reportUrl],
    queryFn: () =>
      fetchRenderReport({
        data: {
          reportUrl,
        },
      }),
  });
  const reportError = getRenderReportError(data);
  const reportIssues = getRenderReportIssues(data);
  const reportLogs = getRenderReportLogs(data);

  return (
    <>
      <div className="grid grid-cols-1 gap-2">
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
          <p className="font-medium text-foreground">{data.status}</p>
        </div>
      </div>

      {reportError ? (
        <section className="space-y-2">
          <h4 className="font-semibold text-foreground">Error</h4>
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="font-medium text-destructive">
              {reportError.name ? `${reportError.name}: ` : ''}
              {reportError.message}
            </p>
            {reportError.stack ? (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-destructive">
                {reportError.stack}
              </pre>
            ) : null}
          </div>
        </section>
      ) : null}

      {reportIssues.length > 0 && (
        <section className="space-y-2">
          <h4 className="font-semibold text-foreground">Validation issues</h4>
          <ul className="space-y-2">
            {reportIssues.map((issue, index) => (
              <li key={`${issue.location}-${index}`} className="rounded-md border border-border px-3 py-2">
                <p className="font-medium text-foreground">
                  {issue.level} {issue.location ? `- ${issue.location}` : ''}
                </p>
                <p className="mt-1 text-muted-foreground">{issue.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h4 className="font-semibold text-foreground">Log messages</h4>
        <RenderLogViewer logs={reportLogs} />
      </section>
    </>
  );
}

function RenderReportLoadingState() {
  return <p className="text-muted-foreground">Loading report...</p>;
}

function RenderReportErrorState({ error }: { error: Error }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
      {error.message}
    </p>
  );
}

export function RenderReportDialog({ report, onClose }: RenderReportDialogProps) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto p-0 sm:max-w-6xl">
        <DialogHeader className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
          <DialogTitle>Render report</DialogTitle>
          <DialogDescription>
            {report.materialName} - {report.rendererName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4 text-sm">
          <RenderReportErrorBoundary
            key={report.reportUrl}
            fallback={(error) => <RenderReportErrorState error={error} />}
          >
            <Suspense fallback={<RenderReportLoadingState />}>
              <RenderReportDialogContent reportUrl={report.reportUrl} />
            </Suspense>
          </RenderReportErrorBoundary>
        </div>
      </DialogContent>
    </Dialog>
  );
}
