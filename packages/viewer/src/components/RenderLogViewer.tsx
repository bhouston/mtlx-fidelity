import type { RenderLogEntry, RenderLogLevel } from '@mtlx-fidelity/samples';

interface RenderLogViewerProps {
  logs?: RenderLogEntry[];
}

function getLogLevelTextClass(level: RenderLogLevel): string {
  if (level === 'warning') {
    return 'text-orange-800 dark:text-orange-300';
  }
  if (level === 'error') {
    return 'text-red-800 dark:text-red-300';
  }
  return 'text-foreground';
}

export function RenderLogViewer({ logs }: RenderLogViewerProps) {
  if (!logs || logs.length === 0) {
    return <p className="text-muted-foreground">No log messages.</p>;
  }

  return (
    <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/10 p-3">
      <div className="min-w-max space-y-1 font-mono text-xs leading-5">
        {logs.map((entry, index) => {
          const level = entry.level;
          const levelLabel = level.toUpperCase();
          const message = entry.message.replace(/\r?\n/g, '\\n');
          return (
            <p key={`${entry.message}-${index}`} className={`whitespace-pre ${getLogLevelTextClass(level)}`}>
              {`${levelLabel} [${entry.source}] ${message}`}
            </p>
          );
        })}
      </div>
    </div>
  );
}
