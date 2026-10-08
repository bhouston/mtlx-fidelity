import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateMaterial } from './material-validation.js';

async function validate(xml: string) {
  const materialPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'fidelity-')), 'material.mtlx');
  await writeFile(materialPath, xml, 'utf8');
  return validateMaterial(materialPath);
}

describe('validateMaterial', () => {
  it('accepts nodes declared by a nodedef in the document', async () => {
    const result = await validate(`<materialx version="1.39">
  <nodedef name="ND_custom" node="custom"><output name="out" type="color3" /></nodedef>
  <custom name="custom_node" type="color3" />
</materialx>`);
    expect(result.fatalIssues).toEqual([]);
  });

  it('rejects unknown node categories', async () => {
    const result = await validate(`<materialx version="1.39"><custom name="custom_node" type="color3" /></materialx>`);
    expect(result.fatalIssues.map((issue) => issue.message)).toEqual(['Unknown node category "custom"']);
  });
});
