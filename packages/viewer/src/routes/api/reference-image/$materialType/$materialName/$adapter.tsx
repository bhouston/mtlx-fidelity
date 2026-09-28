import { createFileRoute } from '@tanstack/react-router';
import { readFile } from 'node:fs/promises';
import { rendererImagePath } from '@mtlx-fidelity/samples';
import { pathExists, resolveMaterialDirectory, resolveSampleRoots } from '@mtlx-fidelity/samples-io';
import { contentHashFromBytes, referenceAssetGetResponse } from '#/lib/reference-asset-response.server';

const IMAGE_CONTENT_HASH_QUERY_PARAM = 'v';

function noStoreErrorResponse(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export const Route = createFileRoute('/api/reference-image/$materialType/$materialName/$adapter')({
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

        const filePath = rendererImagePath(materialDirectory, params.adapter);
        if (!(await pathExists(filePath))) {
          return new Response('Not found', { status: 404 });
        }

        const bytes = await readFile(filePath);
        const requestImageHash = new URL(request.url).searchParams.get(IMAGE_CONTENT_HASH_QUERY_PARAM);
        if (process.env.NODE_ENV !== 'production') {
          return referenceAssetGetResponse(request, bytes, 'image/avif', { noStore: true });
        }

        if (!requestImageHash) {
          return noStoreErrorResponse('Missing image content hash');
        }

        const imageHash = contentHashFromBytes(bytes);
        if (requestImageHash !== imageHash) {
          return noStoreErrorResponse('Invalid image content hash');
        }

        return referenceAssetGetResponse(request, bytes, 'image/avif', {
          contentHash: imageHash,
          immutable: true,
        });
      },
    },
  },
});
