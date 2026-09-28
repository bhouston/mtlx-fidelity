import type { RendererDescriptor } from './types.js';

/** Built-in renderer names and categories without importing renderer packages (for viewer index). */
export const BUILT_IN_RENDERER_DESCRIPTORS: RendererDescriptor[] = [
  {
    name: 'materialx-glsl',
    category: 'rasterizer',
    sortIndex: 10,
    description: 'MaterialXView built with the OpenGL/GLSL backend',
    packageName: '@mtlx-fidelity/renderer-materialxview',
    sourceName: 'MaterialXView GLSL',
    sourceUrl: 'https://github.com/AcademySoftwareFoundation/MaterialX/tree/main/source/MaterialXView',
  },
  {
    name: 'materialx-metal',
    category: 'rasterizer',
    sortIndex: 11,
    description: 'MaterialXView built with the Metal/MSL backend',
    packageName: '@mtlx-fidelity/renderer-materialxview',
    sourceName: 'MaterialXView Metal',
    sourceUrl: 'https://github.com/AcademySoftwareFoundation/MaterialX/tree/main/source/MaterialXView',
  },
  {
    name: 'materialx-osl',
    category: 'raytracer',
    sortIndex: 12,
    description: 'MaterialX OSL rendering through Open Shading Language',
    packageName: '@mtlx-fidelity/renderer-materialxview',
    sourceName: 'MaterialXRenderOsl',
    sourceUrl: 'https://github.com/AcademySoftwareFoundation/MaterialX/tree/main/source/MaterialXRenderOsl',
  },
  {
    name: 'blender-new',
    category: 'pathtracer',
    sortIndex: 20,
    description: 'Blender MaterialX Importer rendered through Cycles',
    packageName: '@mtlx-fidelity/renderer-blender',
    sourceName: 'Blender MaterialX Importer',
    sourceUrl: 'https://github.com/bhouston/mtlx-blender-importer',
  },
  {
    name: 'blender-nodes',
    category: 'pathtracer',
    sortIndex: 30,
    description: 'Blender MaterialX Importer through Cycles with Blender custom MaterialX nodes PR #158054',
    packageName: '@mtlx-fidelity/renderer-blender',
    sourceName: 'Blender MaterialX Importer',
    sourceUrl: 'https://github.com/bhouston/mtlx-blender-importer',
  },
  {
    name: 'blender-eevee-nodes',
    category: 'rasterizer',
    sortIndex: 40,
    description: 'Blender MaterialX Importer through Eevee with Blender custom MaterialX nodes PR #158054',
    packageName: '@mtlx-fidelity/renderer-blender',
    sourceName: 'Blender MaterialX Importer',
    sourceUrl: 'https://github.com/bhouston/mtlx-blender-importer',
  },
  {
    name: 'threejs-current',
    category: 'rasterizer',
    sortIndex: 50,
    description: 'Built-in Three.js MaterialX loader from the official release (three@0.186.1, 2026-09-24)',
    packageName: '@mtlx-fidelity/renderer-threejs',
    sourceName: 'Three.js r186',
    sourceUrl: 'https://github.com/mrdoob/three.js/releases/tag/r186',
  },
  {
    name: 'threejs-new',
    category: 'rasterizer',
    sortIndex: 60,
    description:
      'Experimental MaterialX loader from Three.js PR #34593, built on top of the mrdoob/three.js dev branch',
    packageName: '@mtlx-fidelity/renderer-threejs',
    sourceName: 'Three.js PR #34593',
    sourceUrl: 'https://github.com/mrdoob/three.js/pull/34593',
  },
];

export function sortRendererDescriptors(left: RendererDescriptor, right: RendererDescriptor): number {
  if (left.sortIndex !== right.sortIndex) {
    return left.sortIndex - right.sortIndex;
  }
  return left.name.localeCompare(right.name);
}
