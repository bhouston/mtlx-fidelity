# MTLX Fidelity

[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/wzQWaBBxup)

MTLX Fidelity is part of the [mtlx suite of tools](https://mtlx.ai) ([GitHub](https://github.com/bhouston/mtlx)).

MTLX Fidelity (available online at https://material-fidelity.ben3d.ca) is a website and toolset for generating and comparing renderer output for known MaterialX sample scenes. It is the test suite behind the work described in [Pixel-Perfect MaterialX in Blender and Three.js](https://ben3d.ca/blog/pixel-perfect-materialx-in-blender-and-threejs).

![MaterialX showcase — materialxview vs Three.js vs Blender](docs/images/materialx-showcase.webp)

Every material is rendered through MaterialX reference backends and compared side-by-side against Three.js (rasterizer) and Blender Eevee/Cycles. The suite covers 400+ materials across `standard_surface`, `gltf_pbr`, and `open_pbr_surface`, including procedural noise, math nodes, compositing, coordinate transforms, and surface-model variants.

![MaterialX 2D noise — reference vs Blender before and after](docs/images/materialx-noise2d.webp)

## Related Work

- **[Three.js PR #33485](https://github.com/mrdoob/three.js/pull/33485)** — MaterialX upgrade: near-perfect fidelity across all 400+ samples, new `open_pbr_surface` / `gltf_pbr` support, archive loading, corrected noise implementations. Merged and shipped in the official `MaterialXLoader` (`threejs-current`).
- **[Three.js PR #34593](https://github.com/mrdoob/three.js/pull/34593)** — MaterialX nodedef defaults, built on top of the `dev` branch tip (`threejs-new`).
- **[mtlx-blender-importer](submodules/mtlx-blender-importer)** — Python importer that compiles MaterialX graphs into Blender node graphs, supporting both Cycles and Eevee.
- **[Blender PR #158054](https://projects.blender.org/blender/blender/pulls/158054)** — Custom MaterialX noise nodes for Blender (Cycles OSL/GLSL and Eevee): `MxNoise`, `MxFractal`, `MxCellNoise`, `MxWorleyNoise`, `MxUnifiedNoise` in both 2D and 3D variants.

## Repository Layout

- `packages/core` - renderer interfaces and reference-generation orchestration.
- `packages/cli` - command line tool for running renders.
- `packages/renderer-*` - renderer packages
- `submodules/MaterialX` - custom MaterialX branch used by the MaterialXView GLSL/Metal and OSL reference renderers
- `submodules/OpenShadingLanguage` - Open Shading Language sources used to provide **`oslc`** and **`testrender`** for the **`materialx-osl`** renderer (build/install instructions: `docs/building-openshadinglanguage.md`)
- `submodules/blender` - patched Blender branch with custom MaterialX nodes used by `blender-nodes` and `blender-eevee-nodes`
- `submodules/mtlx-blender-importer` - standalone Blender MaterialX importer used by the Blender fidelity renderers
- `submodules/three.js` - custom Three.js branch used only by the `threejs-new` renderer

## Building Blender and MaterialX

This repository includes **step-by-step build instructions** for compiling the vendored MaterialX and Blender trees locally (artifacts live under git-ignored `build/`):

- [docs/building-materialx.md](docs/building-materialx.md) — MaterialXView (GLSL/Metal) and `materialx-osl`
- [docs/building-openshadinglanguage.md](docs/building-openshadinglanguage.md) — Open Shading Language **`oslc`** / **`testrender`** for `materialx-osl` (sources in **`submodules/OpenShadingLanguage`**; install e.g. under `build/osl-dist/`)
- [docs/BUILDING_BLENDER.md](docs/BUILDING_BLENDER.md) — patched Blender for `blender-nodes` and `blender-eevee-nodes`

The **`materialx-glsl`** and **`materialx-metal`** renderers use MaterialXView binaries built from **`submodules/MaterialX`** (typically under `build/materialx-glsl` / `build/materialx-metal`). **`materialx-osl`** uses **`materialx-osl`** from **`submodules/MaterialX`** **and** relies on an Open Shading Language install for **`oslc`** and **`testrender`** (typically **`submodules/OpenShadingLanguage`** built into `build/osl-dist/` — see the OSL doc). The **`blender-nodes`** and **`blender-eevee-nodes`** renderers use a **custom Blender build from the `submodules/blender` submodule** (see `docs/BUILDING_BLENDER.md`; the patched app bundle is typically under `build/blender/`).

Both docs describe redirecting verbose CMake/Ninja output to log files so builds stay reviewable without flooding terminals or LLM sessions.

## Requirements

- Node.js 24+
- pnpm 10+
- MaterialX reference executables built under `build/materialx-*` (see `docs/building-materialx.md`) or available on `PATH`; for **`materialx-osl`**, also an Open Shading Language install with **`oslc`** and **`testrender`** (see `docs/building-openshadinglanguage.md`)
- Blender 4.0+ available as `blender` on your `PATH` or via `BLENDER_EXECUTABLE`; `blender-nodes` and `blender-eevee-nodes` require the patched Blender executable from `build/blender` (see `docs/BUILDING_BLENDER.md`) or `BLENDER_NODES_EXECUTABLE`

## Install

```bash
# pull in samples, custom renderer dependencies, and add-ons
git submodule update --init --recursive
```

```bash
pnpm install
```

## Build and Validate

```bash
pnpm build
pnpm tsc
pnpm lint
pnpm format
pnpm test
```

`pnpm build` builds the custom `submodules/three.js` package before the remaining workspace packages so `threejs-new` uses a fresh vendored Three.js build.

For native C++ builds (Blender, MaterialX, Open Shading Language), see [Building Blender and MaterialX](#building-blender-and-materialx) above.

## CLI

Generate reference images:

```bash
# all renderers, all materials
pnpm cli render
```

```bash
# only generate Three.js renders of open_pbr materials
pnpm cli render --renderers threejs-new --materials open_pbr
```

This command writes `beauty/<renderer-name>.avif` in each directory containing a `.mtlx` material file (the [fidelity-kit](https://github.com/bhouston/fidelity-kit) folder contract).

Metrics (PSNR, RMSE, MAE, max error) and delta images against the `materialx-glsl` reference are produced by fidelity-kit (see [Results site](#results-site)); there is no separate metrics command.

Currently supported renderers:

- `materialx-glsl` (`@mtlx-fidelity/renderer-materialxview`, MaterialXView OpenGL/GLSL)
- `materialx-metal` (`@mtlx-fidelity/renderer-materialxview`, MaterialXView Metal/MSL)
- `materialx-osl` (`@mtlx-fidelity/renderer-materialxview`, MaterialX OSL)
- `blender-new` (`@mtlx-fidelity/renderer-blender`, Blender bundled MaterialX rendered through Cycles)
- `blender-nodes` (`@mtlx-fidelity/renderer-blender`, patched Blender custom MaterialX nodes rendered through Cycles)
- `blender-eevee-nodes` (`@mtlx-fidelity/renderer-blender`, patched Blender custom MaterialX nodes rendered through Eevee)
- `threejs-current` (`@mtlx-fidelity/renderer-threejs`, official npm Three.js MaterialX support)
- `threejs-new` (`@mtlx-fidelity/renderer-threejs`, custom MaterialX support proposal)

Optional flags:

- `--renderers <selector[,selector...]>` optional renderer filter; supports repeated flags, comma-separated values, and substring matches such as `threejs` or `blender`
- `--materials <selector[,selector...]>` optional material filter; matches against each material directory name only (leaf directory), supports repeated flags, comma-separated values, substring matches, and regex selectors (`re:...` or `/.../flags`)
- `--concurrency <number>` optional render concurrency; defaults to the recommended available parallelism, with a minimum of `1`
- `--skip-existing` only render renderer/material pairs whose `beauty/<renderer-name>.avif` output does not already exist

## Material Organization

Samples are organized by purpose:

- `submodules/mtlx-sample-library/materials/nodes` - canonical per-node tests
- `submodules/mtlx-sample-library/materials/surfaces/<surface_type>` - focused surface-attribute/debug samples grouped by shader family
- `submodules/mtlx-sample-library/materials/showcase/<surface_type>` - complex, transferable showcase materials grouped by shader family

## Node Isolation Suite

The node isolation materials currently live under:

- `submodules/mtlx-sample-library/materials/surfaces/gltf_pbr/node_isolation`

Each node gets its own directory and `<node-name>.mtlx`, with phase planning documented in:

- `submodules/mtlx-sample-library/materials/surfaces/gltf_pbr/node_isolation/PHASES.md`

### Validate Node Isolation Materials

```bash
# single material (run from repo root)
pnpm --filter @material-viewer/mtlx start check "$PWD/submodules/mtlx-sample-library/materials/surfaces/gltf_pbr/node_isolation/add/add.mtlx"
```

```bash
# validate all node-isolation materials
python3 - <<'PY'
from pathlib import Path
import subprocess

root = Path.cwd()
files = sorted((root / "submodules/mtlx-sample-library/materials/surfaces/gltf_pbr/node_isolation").glob("*/*.mtlx"))
for file in files:
    subprocess.run(
        ["pnpm", "--filter", "@material-viewer/mtlx", "start", "check", str(file)],
        check=True,
    )
print(f"Validated {len(files)} materials.")
PY
```

### Regenerate Node Isolation References

```bash
# all node-isolation materials
pnpm cli render --materials node_isolation
```

```bash
# targeted node subset by regex on leaf directory names
pnpm cli render --materials "re:(image|tiledimage|transformmatrix)$"
```

## Surface Input Coverage

Surface samples now follow an input-driven naming convention:

- `input_<primary_input>` for single-input isolates
- `graph_<target_input>_<source>` for graph-driven isolates
- `showcase_<stack_or_look>` for intentionally multi-feature examples

Coverage and rename artifacts:

- `docs/surface-input-coverage-baseline.json`
- `docs/surface-input-coverage-baseline.md`
- `docs/surface-sample-rename-map.md`

## Reference Renderer Setup

To keep reference renders visually comparable between `materialx-glsl`, `materialx-metal`, `threejs-new`, and `threejs-current`, these renderers should follow this framing setup:

- camera: perspective, FOV `45`, near `0.05`, eye `(0,0,5)`, look target `(0,0,0)`
- model normalization: center the loaded `ShaderBall.glb` at the origin, then scale it so the bounding-box sphere radius is `2.0` (matching `MaterialXView`'s `IDEAL_MESH_SPHERE_RADIUS`)
- lighting for capture: IBL from `san_giuseppe_bridge_2k.hdr`, environment background enabled, direct light disabled, shadow map disabled
- environment orientation parity: apply a Y rotation offset of `-90` degrees in the Three.js viewer (`scene.environmentRotation.y`) to match MaterialXView lighting orientation
- color/output: no tone mapping, sRGB output encoding
- visible background comes from the active environment HDR (`san_giuseppe_bridge_2k.hdr`)
- fixed resolution of `512x512`

These values are intentionally aligned with `MaterialXView` defaults and its scene normalization behavior in `source/MaterialXView/Viewer.cpp`.
`threejs-new` resolves Three.js from the custom `submodules/three.js` submodule, including both the core WebGPU/TSL build and `examples/jsm/loaders/MaterialXLoader.js`; `threejs-current` continues to use the npm-installed `three` package.
The **`materialx-glsl`** and **`materialx-metal`** reference renderers prefer MaterialXView binaries built from **`submodules/MaterialX`** (under `build/materialx-*`). **`materialx-osl`** uses the **`materialx-osl`** executable from **`submodules/MaterialX`** and, at run time, the Open Shading Language toolchain (**`oslc`**, **`testrender`**) from an install such as **`build/osl-dist/`** (see [docs/building-openshadinglanguage.md](docs/building-openshadinglanguage.md)).
The Blender renderers follow the same scene contract through background Python scripts. **`blender-new`** uses the `submodules/mtlx-blender-importer` submodule with Blender's bundled MaterialX; **`blender-nodes`** and **`blender-eevee-nodes`** use the same importer but run against the **custom Blender build from the `submodules/blender` submodule** (patched MaterialX nodes).

The importer is intentionally maintained as a separate project. This repository keeps the shader-ball setup, render orchestration, image outputs used to validate its Cycles and Eevee fidelity.

## Results site

Comparison metrics, delta images, and the website come from [fidelity-kit](https://github.com/bhouston/fidelity-kit). Renderer settings live in `submodules/mtlx-sample-library/materials/fidelity.json` (`materialx-glsl` is the reference).

```bash
pnpm fidelity:dev      # process stale comparisons, then serve on http://localhost:3000
pnpm fidelity:process  # only compute metrics and delta images
pnpm fidelity:build    # export a static site to site/
```

Production is a Docker image (`docker/results.Dockerfile`, built with `submodules/mtlx-sample-library/materials` as context) that runs `fidelity-kit process`, `hash`, then `serve`.

## Results introduction

Edit `submodules/mtlx-sample-library/materials/README.md` (in the sample-library repository) to update the Markdown introduction above the fidelity comparisons. Renderer descriptions are maintained in that file.

## License

MIT. See `LICENSE`.
