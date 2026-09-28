import type { FidelityRenderer } from '@mtlx-fidelity/core';

interface ResolveRendererNamesOptions {
  defaultToAll: boolean;
}

export function resolveRendererNames(
  renderers: FidelityRenderer[],
  requestedRendererNames: string[],
  options: ResolveRendererNamesOptions,
): string[] {
  const availableRendererNames = renderers.map((renderer) => renderer.name);
  if (requestedRendererNames.length === 0) {
    return options.defaultToAll ? availableRendererNames : [];
  }

  const selectedRendererNames: string[] = [];
  const missingRendererNames: string[] = [];
  for (const requestedRendererName of requestedRendererNames) {
    const normalizedRequestedRendererName = requestedRendererName.toLowerCase();
    const matches = availableRendererNames.filter((rendererName) =>
      rendererName.toLowerCase().includes(normalizedRequestedRendererName),
    );

    if (matches.length === 0) {
      missingRendererNames.push(requestedRendererName);
      continue;
    }

    for (const match of matches) {
      if (!selectedRendererNames.includes(match)) {
        selectedRendererNames.push(match);
      }
    }
  }

  if (missingRendererNames.length > 0) {
    throw new Error(
      `Renderer selector(s) "${missingRendererNames.join(', ')}" not found. Available renderers: ${availableRendererNames.toSorted().join(', ')}.`,
    );
  }

  return selectedRendererNames;
}
