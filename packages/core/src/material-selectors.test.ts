import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { materialMatchesSelector } from '@mtlx-fidelity/samples';

describe('materialMatchesSelector', () => {
  const materialPath = path.join('/tmp', 'materials', 'surfaces', 'gltf_pbr', 'included', 'included.mtlx');

  it('matches substring selectors against the material directory leaf name', () => {
    expect(materialMatchesSelector(materialPath, 'incl')).toBe(true);
  });

  it('does not match substring selectors against parent directory names', () => {
    expect(materialMatchesSelector(materialPath, 'gltf_pbr')).toBe(false);
    expect(materialMatchesSelector(materialPath, 'surfaces')).toBe(false);
  });

  it('matches regex selectors against the material directory leaf name', () => {
    expect(materialMatchesSelector(materialPath, '/^incl/i')).toBe(true);
  });
});
