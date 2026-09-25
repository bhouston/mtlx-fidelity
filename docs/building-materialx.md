# Building MaterialX Locally

This repository vendors the MaterialX checkout as `submodules/MaterialX`.
Build outputs should stay in ignored repo-local directories under `build/`.

The MaterialXView executable is compiled for one hardware backend at a time, so the fidelity renderers use separate build directories:

```text
build/materialx-glsl/bin/MaterialXView
build/materialx-metal/bin/MaterialXView
build/materialx-osl/bin/materialx-osl
```

The renderer package automatically prefers these paths before falling back to `materialx-glsl`, `materialx-metal`, `materialx-osl`, `materialxview`, or `MaterialXView` on `PATH`.

## Prerequisites

- CMake and Ninja.
- Xcode command line tools on macOS.
- **Open Shading Language (`oslc`, `testrender`)** — required **only** for the **`materialx-osl`** renderer. MaterialX does not ship OSL; point CMake at a consistent install (for example build OSL from **`submodules/OpenShadingLanguage`** into `build/osl-dist/` — see [building-openshadinglanguage.md](building-openshadinglanguage.md)). You can also use Homebrew or another install if you set `MATERIALX_OSL_BINARY_*` accordingly.
- Nested MaterialX submodules (NanoGUI, etc.): from `submodules/MaterialX`, run `git submodule update --init --recursive`.

## Build type (Release vs Debug)

These recipes pass **`-DCMAKE_BUILD_TYPE=Release`** so reference renders use **optimized** binaries.

MaterialX’s CMake does **not** default `CMAKE_BUILD_TYPE` for single-configuration generators (Ninja); without an explicit type, the cache can stay **empty** and you may not get normal Release optimizations. By contrast, **Open Shading Language** (`submodules/OpenShadingLanguage`) sets **`Release`** when `CMAKE_BUILD_TYPE` is unset, and **Blender** initializes **`CMAKE_BUILD_TYPE`** to **`Release`** unless you override it (see [BUILDING_BLENDER.md](BUILDING_BLENDER.md)).

For debugging MaterialX or renderers, reconfigure with **`-DCMAKE_BUILD_TYPE=Debug`** (or **`RelWithDebInfo`**) in the same build directory.

## Context minimization (log files)

CMake configure steps and `cmake --build` runs print large volumes of text. In LLM-assisted sessions (for example Cursor agents), piping that output into the conversation wastes context and buries compiler errors.

**Strategy:** append all tool output to files under `build/logs/` (ignored by git because `/build/` is ignored). Share only short tails or `grep` results when debugging.

1. **One log file per phase** keeps failures easy to find:

   ```bash
   mkdir -p build/logs
   cmake -S "$PWD/submodules/MaterialX" -B "$PWD/build/materialx-glsl" -G Ninja \
     -DCMAKE_BUILD_TYPE=Release \
     -DMATERIALX_BUILD_VIEWER=ON ... \
     >> build/logs/cmake-materialx-glsl.log 2>&1
   cmake --build "$PWD/build/materialx-glsl" --target MaterialXView \
     >> build/logs/build-materialx-glsl.log 2>&1
   ```

   Repeat with distinct filenames for `materialx-metal` and `materialx-osl` (for example `cmake-materialx-metal.log`, `build-materialx-osl.log`).

2. **Submodule init** can also be heavy; redirect it the same way:

   ```bash
   (cd submodules/MaterialX && git submodule update --init --recursive) \
     >> build/logs/materialx-submodules.log 2>&1
   ```

3. **On failure:** use `tail -80 build/logs/build-materialx-glsl.log` or `grep -i error build/logs/...` instead of streaming a full rebuild.

4. **Optional:** `export NINJA_STATUS="[%f/%t] "` for slightly shorter Ninja lines (logging still matters most).

## GLSL MaterialXView

On macOS, force the OpenGL backend so this build can be used as the `materialx-glsl` reference renderer:

```bash
cmake -S "$PWD/submodules/MaterialX" \
  -B "$PWD/build/materialx-glsl" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMATERIALX_BUILD_VIEWER=ON \
  -DMATERIALX_BUILD_RENDER=ON \
  -DMATERIALX_BUILD_RENDER_PLATFORMS=ON \
  -DUSE_OPENGL_BACKEND_ON_APPLE_PLATFORM=ON
```

```bash
cmake --build "$PWD/build/materialx-glsl" --target MaterialXView
```

## Metal MaterialXView

Build a separate Metal-backed MaterialXView for the `materialx-metal` reference renderer:

```bash
cmake -S "$PWD/submodules/MaterialX" \
  -B "$PWD/build/materialx-metal" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMATERIALX_BUILD_VIEWER=ON \
  -DMATERIALX_BUILD_RENDER=ON \
  -DMATERIALX_BUILD_RENDER_PLATFORMS=ON \
  -DMATERIALX_BUILD_GEN_MSL=ON \
  -DMATERIALX_RENDER_MSL_ONLY=ON
```

```bash
cmake --build "$PWD/build/materialx-metal" --target MaterialXView
```

## OSL Renderer

Configure the OSL renderer with explicit paths to **`oslc`** and **`testrender`** from your Open Shading Language installation.

**Recommended (repo-local install prefix):** build OSL from **`submodules/OpenShadingLanguage`** into **`build/osl-dist`** (full macOS/Homebrew recipe with **`fmt`** / **`CPATH`** and log files: [building-openshadinglanguage.md](building-openshadinglanguage.md)), then configure **`materialx-osl`**:

```bash
cmake -S "$PWD/submodules/MaterialX" \
  -B "$PWD/build/materialx-osl" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMATERIALX_BUILD_VIEWER=OFF \
  -DMATERIALX_BUILD_RENDER=ON \
  -DMATERIALX_BUILD_RENDER_PLATFORMS=ON \
  -DMATERIALX_BUILD_GEN_OSL=ON \
  -DMATERIALX_OSL_BINARY_OSLC="$PWD/build/osl-dist/bin/oslc" \
  -DMATERIALX_OSL_BINARY_TESTRENDER="$PWD/build/osl-dist/bin/testrender" \
  -DMATERIALX_OSL_INCLUDE_PATH="$PWD/build/osl-dist/share/OSL/shaders"
```

**LLM-friendly logging** (same pattern as [above](#context-minimization-log-files)):

```bash
mkdir -p build/logs
cmake -S "$PWD/submodules/MaterialX" \
  -B "$PWD/build/materialx-osl" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMATERIALX_BUILD_VIEWER=OFF \
  -DMATERIALX_BUILD_RENDER=ON \
  -DMATERIALX_BUILD_RENDER_PLATFORMS=ON \
  -DMATERIALX_BUILD_GEN_OSL=ON \
  -DMATERIALX_OSL_BINARY_OSLC="$PWD/build/osl-dist/bin/oslc" \
  -DMATERIALX_OSL_BINARY_TESTRENDER="$PWD/build/osl-dist/bin/testrender" \
  -DMATERIALX_OSL_INCLUDE_PATH="$PWD/build/osl-dist/share/OSL/shaders" \
  >> build/logs/cmake-materialx-osl.log 2>&1
cmake --build "$PWD/build/materialx-osl" --target materialx-osl \
  >> build/logs/build-materialx-osl.log 2>&1
```

(`stdosl.h` usually lives under `share/OSL/shaders` in an OSL install; use the directory that contains that file on your system.)

**Alternative:** Homebrew often installs tools under `/opt/homebrew/bin` on Apple Silicon:

```bash
-DMATERIALX_OSL_BINARY_OSLC="/opt/homebrew/bin/oslc" \
-DMATERIALX_OSL_BINARY_TESTRENDER="/opt/homebrew/bin/testrender"
```

If OSL headers are elsewhere, set:

```bash
-DMATERIALX_OSL_INCLUDE_PATH="/path/to/osl/include"
```

Build the command-line renderer:

```bash
cmake --build "$PWD/build/materialx-osl" --target materialx-osl
```

The build copies the OSL utility shaders to `build/materialx-osl/bin/resources/Utilities`, which `materialx-osl` needs at runtime.

## Running Fidelity Renders

After the builds are present, no PATH changes are required for the repo-local executables:

```bash
pnpm cli render --renderers materialx-glsl,materialx-metal,materialx-osl
```

You can still put different MaterialX executables on `PATH` for experiments. The repo-local `build/materialx-*` executables take precedence when present.
