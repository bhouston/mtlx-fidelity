import { copyFile } from 'node:fs/promises';

// Keep site-specific copy in this repository, outside the sample-library submodule.
await copyFile(
  new URL('../results/index.md', import.meta.url),
  new URL('../submodules/mtlx-sample-library/materials/index.md', import.meta.url),
);
