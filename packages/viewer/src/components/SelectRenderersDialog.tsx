import { Filter } from 'lucide-react';
import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog';
import { getRendererMetadata } from '#/lib/renderer-metadata';

const NO_RENDERERS_SEARCH_VALUE = '__none';
const DEFAULT_RENDERERS = [
  'materialx-glsl',
  'materialx-metal',
  'materialx-osl',
  'blender-nodes',
  'blender-eevee-nodes',
  'threejs-new',
];

function getDefaultSelectedRenderers(availableRenderers: string[]): string[] {
  const defaultRendererSet = new Set(DEFAULT_RENDERERS);
  const defaultSelectedRenderers = availableRenderers.filter((rendererName) => defaultRendererSet.has(rendererName));
  return defaultSelectedRenderers.length > 0 ? defaultSelectedRenderers : availableRenderers;
}

function normalizeRendererFilters(rendererFilter: string | undefined): string[] | undefined {
  if (!rendererFilter) {
    return undefined;
  }

  if (rendererFilter === NO_RENDERERS_SEARCH_VALUE) {
    return [];
  }

  return [
    ...new Set(
      rendererFilter
        .split(',')
        .map((filter) => filter.trim())
        .filter((filter) => filter.length > 0),
    ),
  ];
}

export function resolveSelectedRenderers(rendererFilter: string | undefined, availableRenderers: string[]): string[] {
  const normalizedFilters = normalizeRendererFilters(rendererFilter);
  if (normalizedFilters === undefined) {
    return getDefaultSelectedRenderers(availableRenderers);
  }

  const normalizedFilterSet = new Set(normalizedFilters);
  return availableRenderers.filter((rendererName) => normalizedFilterSet.has(rendererName));
}

export function toRendererSearchValue(selectedRenderers: string[], availableRenderers: string[]): string | undefined {
  if (selectedRenderers.length === 0) {
    return NO_RENDERERS_SEARCH_VALUE;
  }

  const defaultSelectedRenderers = getDefaultSelectedRenderers(availableRenderers);
  if (
    selectedRenderers.length === defaultSelectedRenderers.length &&
    selectedRenderers.every((rendererName, index) => rendererName === defaultSelectedRenderers[index])
  ) {
    return undefined;
  }

  return selectedRenderers.join(',');
}

interface SelectRenderersDialogProps {
  availableRenderers: string[];
  rendererFilter?: string;
  onSelectedRenderersChange: (selectedRenderers: string[]) => void;
}

export function SelectRenderersDialog({
  availableRenderers,
  rendererFilter,
  onSelectedRenderersChange,
}: SelectRenderersDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedRenderers = resolveSelectedRenderers(rendererFilter, availableRenderers);
  const selectedRendererSet = new Set(selectedRenderers);

  const handleRendererToggle = (rendererName: string, enabled: boolean) => {
    const nextSelectedRendererSet = new Set(selectedRenderers);
    if (enabled) {
      nextSelectedRendererSet.add(rendererName);
    } else {
      nextSelectedRendererSet.delete(rendererName);
    }

    onSelectedRenderersChange(availableRenderers.filter((candidate) => nextSelectedRendererSet.has(candidate)));
  };

  const handleSelectAllRenderers = () => {
    onSelectedRenderersChange(availableRenderers);
  };

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <button
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-none border border-border bg-muted/40 px-2.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-muted/60"
          type="button"
        >
          <Filter className="size-4" />
          <span className="hidden sm:inline">Renderers</span>
          <span className="text-muted-foreground">
            {selectedRenderers.length}/{availableRenderers.length}
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="top-20 max-w-md translate-y-0 p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Renderer Filter</DialogTitle>
          <DialogDescription>Choose which renderer columns are shown in the comparison grid.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {selectedRenderers.length} of {availableRenderers.length} enabled
            </p>
            <button
              className="text-sm font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground"
              onClick={handleSelectAllRenderers}
              type="button"
            >
              Select all
            </button>
          </div>

          <div className="space-y-3">
            {availableRenderers.map((rendererName) => {
              const metadata = getRendererMetadata(rendererName);
              return (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/40"
                  key={rendererName}
                >
                  <input
                    aria-label={rendererName}
                    checked={selectedRendererSet.has(rendererName)}
                    className="mt-1 size-4 accent-primary"
                    onChange={(event) => handleRendererToggle(rendererName, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{rendererName}</span>
                    <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
                      {metadata?.description ?? 'Renderer description unavailable.'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
