This viewer lists [MaterialX](https://materialx.org/) sample materials and compares renderer reference renders side-by-side so you can quickly spot visual differences. Select a material to inspect its results in more detail.

**Available renderers:**

- `materialx-glsl` — Rasterizer — [MaterialX](https://github.com/AcademySoftwareFoundation/MaterialX) — MaterialXView OpenGL/GLSL reference renderer.
- `materialx-metal` — Rasterizer — [MaterialX](https://github.com/AcademySoftwareFoundation/MaterialX) — MaterialXView Metal/MSL reference renderer.
- `materialx-osl` — Ray tracer — [MaterialX](https://github.com/AcademySoftwareFoundation/MaterialX) — MaterialX OSL reference renderer using Open Shading Language.
- `blender-new` — Path tracer — [Blender](https://www.blender.org/) — Blender's bundled MaterialX rendered through Cycles.
- `blender-nodes` — Path tracer — [Blender custom MaterialX nodes](https://projects.blender.org/blender/blender/pulls/158054) — Patched Blender with custom MaterialX nodes rendered through Cycles.
- `blender-eevee-nodes` — Rasterizer — [Blender custom MaterialX nodes](https://projects.blender.org/blender/blender/pulls/158054) — Patched Blender with custom MaterialX nodes rendered through Eevee.
- `threejs-current` — Rasterizer — [Three.js](https://threejs.org/) — Official npm Three.js MaterialX support.
- `threejs-new` — Rasterizer — [Three.js PR #34593](https://github.com/mrdoob/three.js/pull/34593) — Custom MaterialX support with nodedef defaults.

Some visual differences are expected because these renderers use different rendering techniques. Ray tracers and path tracers can show self-reflections and global illumination that rasterizers usually will not.

Want to contribute?

- [Add your own renderer here.](https://github.com/bhouston/mtlx-fidelity)
- [Add more reference samples here.](https://github.com/bhouston/mtlx-sample-library)

MTLX Fidelity is part of the [mtlx suite of tools](https://mtlx.ai) ([GitHub](https://github.com/bhouston/mtlx)).

This is an independent project maintained by [Ben Houston](https://ben3d.ca), and sponsored by [Land of Assets](https://landofassets.com).
