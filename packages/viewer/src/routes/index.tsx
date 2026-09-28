import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useGoogleAnalytics } from 'tanstack-router-ga4';
import Header from '#/components/Header';
import { ImagePreviewDialog } from '#/components/ImagePreviewDialog';
import { MaterialRow } from '#/components/MaterialRow';
import { MaterialSourceDialog } from '#/components/MaterialSourceDialog';
import { RenderReportDialog } from '#/components/RenderReportDialog';
import { resolveSelectedRenderers, toRendererSearchValue } from '#/components/SelectRenderersDialog';
import type { ActiveImagePreviewState } from '#/components/ImagePreviewDialog';
import type { ActiveMaterialSourceState } from '#/components/MaterialSourceDialog';
import type { ActiveReportState } from '#/components/RenderReportDialog';
import { getViewerIndexData } from '#/lib/material-index';
import {
  parseMaterialSort,
  sortMaterials,
  toMaterialSortSearchValue,
  type MaterialSortValue,
} from '#/lib/material-sort';
import { getRendererMetadata } from '#/lib/renderer-metadata';
import { getHead } from '#/lib/metadata';
import { getViewerWebsiteJsonLd } from '#/lib/structured-data';

const RENDERER_CATEGORY_LABELS = {
  pathtracer: 'Pathtracer',
  raytracer: 'Raytracer',
  rasterizer: 'Rasterizer',
} as const;

const getViewerData = createServerFn({
  method: 'GET',
}).handler(async () => getViewerIndexData());

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => {
    const materials = typeof search.materials === 'string' ? search.materials.trim() : '';
    const renderers = typeof search.renderers === 'string' ? search.renderers.trim() : '';
    const sort = typeof search.sort === 'string' ? search.sort.trim() : '';
    return {
      materials: materials.length > 0 ? materials : undefined,
      renderers: renderers.length > 0 ? renderers : undefined,
      sort: toMaterialSortSearchValue(parseMaterialSort(sort)),
    };
  },
  loader: () => getViewerData(),
  head: () => {
    const baseUrl = import.meta.env.VITE_BASE_URL.replace(/\/$/, '');
    const canonicalUrl = baseUrl ? `${baseUrl}/` : '';
    return getHead({
      title: import.meta.env.VITE_SITE_NAME,
      description: import.meta.env.VITE_SITE_DESCRIPTION,
      canonicalUrl,
      ogType: 'website',
      imageUrl: import.meta.env.VITE_DEFAULT_SITE_IMAGE,
      twitterCard: 'summary_large_image',
      jsonLd: getViewerWebsiteJsonLd(canonicalUrl || baseUrl),
    });
  },
  component: App,
});

function normalizeMaterialFilters(materialFilter: string | undefined): string[] {
  if (!materialFilter) {
    return [];
  }

  return [
    ...new Set(
      materialFilter
        .split(',')
        .map((filter) => filter.trim().toLocaleLowerCase())
        .filter((filter) => filter.length > 0),
    ),
  ];
}

function App() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const ga = useGoogleAnalytics();
  const [materialFilterInput, setMaterialFilterInput] = useState(search.materials ?? '');
  const materialSearchTerms = normalizeMaterialFilters(search.materials);
  const selectedRenderers = resolveSelectedRenderers(search.renderers, data.renderers);
  const sortValue = parseMaterialSort(search.sort);
  const selectedRendererSet = new Set(selectedRenderers);
  const visibleRendererGroups = data.rendererGroups
    .map((group) => ({
      ...group,
      renderers: group.renderers.filter((rendererName) => selectedRendererSet.has(rendererName)),
    }))
    .filter((group) => group.renderers.length > 0);
  const [activeReport, setActiveReport] = useState<ActiveReportState | null>(null);
  const [activeMaterialSource, setActiveMaterialSource] = useState<ActiveMaterialSourceState | null>(null);
  const hasMaterialFilterChangedRef = useRef(false);
  const lastTrackedMaterialFilterRef = useRef(search.materials?.trim() ?? '');
  const filteredGroups = data.groups
    .map((group) => ({
      ...group,
      materials: group.materials.filter((material) => {
        if (materialSearchTerms.length === 0) {
          return true;
        }
        const lowerName = material.name.toLocaleLowerCase();
        const lowerDisplayPath = material.displayPath.toLocaleLowerCase();
        return materialSearchTerms.some((term) => lowerName.includes(term) || lowerDisplayPath.includes(term));
      }),
    }))
    .filter((group) => group.materials.length > 0);
  const filteredMaterials = sortMaterials(
    filteredGroups.flatMap((group) =>
      group.materials.map((material) => ({
        ...material,
        type: group.type,
      })),
    ),
    sortValue,
    selectedRenderers,
  );
  const shownMaterialCount = filteredGroups.reduce((total, group) => total + group.materials.length, 0);
  const totalMaterialCount = data.groups.reduce((total, group) => total + group.materials.length, 0);
  const [activeImagePreview, setActiveImagePreview] = useState<ActiveImagePreviewState | null>(null);

  useEffect(() => {
    setMaterialFilterInput(search.materials ?? '');
  }, [search.materials]);

  useEffect(() => {
    if (!hasMaterialFilterChangedRef.current) {
      return;
    }

    const normalizedFilter = search.materials?.trim() ?? '';
    if (normalizedFilter === lastTrackedMaterialFilterRef.current) {
      hasMaterialFilterChangedRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      ga.event('material_filter', {
        material_filter_value: normalizedFilter,
        material_filter_length: normalizedFilter.length,
        material_filter_is_empty: normalizedFilter.length === 0,
      });
      lastTrackedMaterialFilterRef.current = normalizedFilter;
      hasMaterialFilterChangedRef.current = false;
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [ga, search.materials]);

  const trackMaterialAction = (
    action: 'download_mtlx' | 'open_live_viewer',
    material: {
      type: string;
      name: string;
      downloadMtlxZipUrl: string;
      liveViewerUrl: string;
    },
  ) => {
    const destinationUrl = action === 'download_mtlx' ? material.downloadMtlxZipUrl : material.liveViewerUrl;

    ga.event(action, {
      material_name: material.name,
      material_type: material.type,
      destination_url: destinationUrl,
    });
  };

  const updateFilters = (next: {
    materials?: string | undefined;
    renderers?: string | undefined;
    sort?: string | undefined;
  }) => {
    navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        ...next,
      }),
    });
  };

  const handleMaterialSearchChange = (value: string) => {
    setMaterialFilterInput(value);
  };

  const handleSelectedRenderersChange = (nextSelectedRenderers: string[]) => {
    updateFilters({
      renderers: toRendererSearchValue(nextSelectedRenderers, data.renderers),
    });
  };

  const handleSortChange = (nextSortValue: MaterialSortValue) => {
    updateFilters({
      sort: toMaterialSortSearchValue(nextSortValue),
    });
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const trimmed = materialFilterInput.trim();
      const nextMaterials = trimmed.length > 0 ? materialFilterInput : undefined;
      if ((search.materials ?? '') === (nextMaterials ?? '')) {
        return;
      }
      hasMaterialFilterChangedRef.current = true;
      updateFilters({
        materials: nextMaterials,
      });
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [materialFilterInput, search.materials]);

  return (
    <>
      <Header
        availableRenderers={data.renderers}
        materialFilter={materialFilterInput}
        onMaterialFilterChange={handleMaterialSearchChange}
        onSelectedRenderersChange={handleSelectedRenderersChange}
        onSortChange={handleSortChange}
        rendererFilter={search.renderers}
        shownMaterialCount={shownMaterialCount}
        sortValue={sortValue}
        totalMaterialCount={totalMaterialCount}
      />
      <main className="mx-auto flex w-full max-w-none flex-col gap-8 px-4 py-6 sm:px-6">
        <section>
          <p className="max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
            This viewer lists{' '}
            <a
              className="underline underline-offset-2 hover:no-underline"
              href="https://materialx.org/"
              rel="noreferrer"
              target="_blank"
            >
              MaterialX
            </a>{' '}
            sample materials and compares renderer reference renders side-by-side so you can quickly spot visual
            differences and view render log/error output (click the <Info className="size-4 inline-block" /> icons).
          </p>
          <div className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
            <p className="font-medium text-foreground">Available renderers:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {data.renderers.map((rendererName) => {
                const metadata = getRendererMetadata(rendererName);
                return (
                  <li key={rendererName}>
                    <code className="font-semibold text-foreground">{rendererName}</code>
                    {metadata ? (
                      <>
                        {' - '}
                        <span>{RENDERER_CATEGORY_LABELS[metadata.category]}</span>
                        {' - '}
                        <a
                          className="underline underline-offset-2 hover:no-underline"
                          href={metadata.sourceUrl}
                          target="_blank"
                        >
                          {metadata.sourceName}
                        </a>{' '}
                        - {metadata.description}
                      </>
                    ) : (
                      ' - Renderer is enabled but has no description metadata yet.'
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3">
              Some visual differences are expected because these renderers use different rendering techniques. Ray
              tracers and path tracers can show self-reflections and global illumination that rasterizers usually will
              not.
            </p>
          </div>
          <div className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
            <p>Want to contribute?</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <a
                  className="underline underline-offset-2 hover:no-underline"
                  href="https://github.com/bhouston/mtlx-fidelity"
                  target="_blank"
                >
                  Add your own renderer here.
                </a>
              </li>
              <li>
                <a
                  className="underline underline-offset-2 hover:no-underline"
                  href="https://github.com/bhouston/mtlx-sample-library"
                  target="_blank"
                >
                  Add more reference samples here.
                </a>
              </li>
            </ul>
          </div>
          <p className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
            MTLX Fidelity is part of the{' '}
            <a className="underline underline-offset-2 hover:no-underline" href="https://mtlx.ai" target="_blank">
              mtlx suite of tools
            </a>{' '}
            (
            <a
              className="underline underline-offset-2 hover:no-underline"
              href="https://github.com/bhouston/mtlx"
              target="_blank"
            >
              GitHub
            </a>
            ).
          </p>
          <p className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground sm:text-base">
            This is an independent project maintained by{' '}
            <a className="underline underline-offset-2 hover:no-underline" href="https://ben3d.ca" target="_blank">
              Ben Houston
            </a>
            , and sponsored by{' '}
            <a
              className="underline underline-offset-2 hover:no-underline"
              href="https://landofassets.com"
              target="_blank"
            >
              Land of Assets
            </a>
            .
          </p>
        </section>

        {data.errors.length > 0 && (
          <section className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <h2 className="text-base font-semibold">Configuration warnings</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.errors.map((errorMessage) => (
                <li key={errorMessage}>{errorMessage}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="pt-2">
          {selectedRenderers.length > 0 ? (
            filteredMaterials.map((material) => (
              <MaterialRow
                key={material.id}
                material={material}
                onInspectMaterial={setActiveMaterialSource}
                onOpenImagePreview={setActiveImagePreview}
                onOpenReport={setActiveReport}
                onTrackMaterialAction={trackMaterialAction}
                rendererGroups={visibleRendererGroups}
              />
            ))
          ) : (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              No renderers selected. Use the renderer filter in the header to enable one or more renderers.
            </div>
          )}
        </section>

        {activeMaterialSource ? (
          <MaterialSourceDialog material={activeMaterialSource} onClose={() => setActiveMaterialSource(null)} />
        ) : null}
        {activeImagePreview ? (
          <ImagePreviewDialog image={activeImagePreview} onClose={() => setActiveImagePreview(null)} />
        ) : null}
        {activeReport ? <RenderReportDialog report={activeReport} onClose={() => setActiveReport(null)} /> : null}
      </main>
    </>
  );
}
