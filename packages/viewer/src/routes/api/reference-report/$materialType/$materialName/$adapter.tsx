import { createFileRoute } from '@tanstack/react-router';
import { readFile } from 'node:fs/promises';
import { rendererReportPath } from '@mtlx-fidelity/samples';
import { pathExists, resolveMaterialDirectory, resolveSampleRoots } from '@mtlx-fidelity/samples-io';
import { referenceAssetGetResponse } from '#/lib/reference-asset-response.server';

export const Route = createFileRoute('/api/reference-report/$materialType/$materialName/$adapter')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const roots = resolveSampleRoots();
        const materialDirectory = await resolveMaterialDirectory(
          roots.materialsRoot,
          params.materialType,
          params.materialName,
        );
        if (!materialDirectory) {
          return new Response('Not found', { status: 404 });
        }

        const filePath = rendererReportPath(materialDirectory, params.adapter);
        if (!(await pathExists(filePath))) {
          return new Response('Not found', { status: 404 });
        }

        const bytes = await readFile(filePath);
        return referenceAssetGetResponse(request, bytes, 'application/json; charset=utf-8');
      },
    },
  },
});
