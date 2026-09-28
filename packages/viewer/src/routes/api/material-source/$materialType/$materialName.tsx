import { createFileRoute } from '@tanstack/react-router';
import { readFile } from 'node:fs/promises';
import { resolveMaterialFilePath, resolveSampleRoots } from '@mtlx-fidelity/samples-io';
import { referenceAssetGetResponse } from '#/lib/reference-asset-response.server';

export const Route = createFileRoute('/api/material-source/$materialType/$materialName')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const roots = resolveSampleRoots();
        const materialPath = await resolveMaterialFilePath(
          roots.materialsRoot,
          params.materialType,
          params.materialName,
        );
        if (!materialPath) {
          return new Response('Not found', { status: 404 });
        }

        const bytes = await readFile(materialPath);
        return referenceAssetGetResponse(request, bytes, 'application/xml; charset=utf-8');
      },
    },
  },
});
