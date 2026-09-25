# Building Open Shading Language (OSL)

The **`materialx-osl`** reference renderer compiles generated shaders with **`oslc`** and renders with **`testrender`**. Those programs come from the **Open Shading Language** project, not from MaterialX. MaterialX’s CMake accepts explicit paths (`MATERIALX_OSL_BINARY_OSLC`, `MATERIALX_OSL_BINARY_TESTRENDER`, optional `MATERIALX_OSL_INCLUDE_PATH`), so installing OSL into a **fixed directory under this repo’s `build/` tree** keeps references reproducible.

This repository vendors OSL source as **`submodules/OpenShadingLanguage`** ([AcademySoftwareFoundation/OpenShadingLanguage](https://github.com/AcademySoftwareFoundation/OpenShadingLanguage)).

## Relationship to MaterialX

- **`materialx-glsl`** / **`materialx-metal`**: do **not** require OSL.
- **`materialx-osl`**: **requires** an OSL install containing at least `oslc` and `testrender`. Build MaterialX with CMake variables pointing at that install (see [building-materialx.md](building-materialx.md)).

## Dependencies

OSL depends on LLVM, OpenImageIO, Imath, and other libraries. Follow the upstream guide for your platform:

- [`submodules/OpenShadingLanguage/INSTALL.md`](../submodules/OpenShadingLanguage/INSTALL.md)

On macOS, Homebrew packages such as `llvm`, `openimageio`, `imath`, `flex`, `bison`, `pugixml`, and **`fmt`** are commonly used; exact versions are listed in that file.

OSL’s CMake defaults **`CMAKE_BUILD_TYPE`** to **`Release`** when it is unset. The commands below still pass **`-DCMAKE_BUILD_TYPE=Release`** explicitly so they stay aligned with [building-materialx.md](building-materialx.md).

## Recommended layout (install prefix under `build/`)

Keep **build artifacts and installs** outside git by using an install prefix under the ignored **`build/`** directory, for example:

```text
build/osl-dist/bin/oslc
build/osl-dist/bin/testrender
build/osl-dist/include/...
build/osl-dist/share/OSL/shaders/stdosl.h
```

### One-shot recipe (macOS + Homebrew)

Copy from the repo root after **`brew install llvm openimageio imath flex bison pugixml zlib fmt`** (and CMake/Ninja). All verbose output goes to **`build/logs/`** so agent sessions are not flooded.

```bash
export PATH="/opt/homebrew/opt/flex/bin:/opt/homebrew/opt/bison:$PATH"
export CPATH="$(brew --prefix fmt)/include"
export CPLUS_INCLUDE_PATH="$(brew --prefix fmt)/include"
PF="$(brew --prefix llvm);$(brew --prefix openimageio);$(brew --prefix imath);$(brew --prefix pugixml);$(brew --prefix zlib);$(brew --prefix fmt)"

mkdir -p build/logs
cmake -S "$PWD/submodules/OpenShadingLanguage" \
  -B "$PWD/build/osl-cmake" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PWD/build/osl-dist" \
  -DCMAKE_PREFIX_PATH="$PF" \
  -DSTOP_ON_WARNING=0 \
  -DUSE_PYTHON=OFF \
  -DUSE_QT=OFF \
  -DUSE_LLVM_BITCODE=OFF \
  >> build/logs/cmake-osl.log 2>&1

ninja -C "$PWD/build/osl-cmake" install >> build/logs/build-osl-install.log 2>&1

( cd "$PWD/submodules/MaterialX" && git submodule update --init --recursive ) \
  >> build/logs/materialx-submodules.log 2>&1

cmake -S "$PWD/submodules/MaterialX" -B "$PWD/build/materialx-osl" -G Ninja \
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

**Why `CPATH` / `CPLUS_INCLUDE_PATH`:** OpenImageIO headers include **`fmt`**. OSL’s install step still invokes **`clang++`** for some LLVM bitcode targets without adding Homebrew **`fmt`**’s include path; exporting those variables fixes **`fmt/format.h` not found**. **`USE_LLVM_BITCODE=OFF`** reduces how often that path runs.

On Intel Macs, replace **`/opt/homebrew`** with **`/usr/local`** in **`PATH`** (and ensure **`brew --prefix`** resolves the same prefixes).

### macOS + Homebrew (step-by-step)

If you want **OSL plus `materialx-osl` in one copy-paste**, use **One-shot recipe** above. The following breaks the OSL configure/install into smaller steps with the same options.

Point CMake at Homebrew prefixes and **put flex/bison early on `PATH`** (Apple’s system Bison may be too old):

```bash
export PATH="/opt/homebrew/opt/flex/bin:/opt/homebrew/opt/bison:$PATH"
PF="$(brew --prefix llvm);$(brew --prefix openimageio);$(brew --prefix imath);$(brew --prefix pugixml);$(brew --prefix zlib);$(brew --prefix fmt)"
```

Configure (full output to logs):

```bash
mkdir -p build/logs
cmake -S "$PWD/submodules/OpenShadingLanguage" \
  -B "$PWD/build/osl-cmake" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PWD/build/osl-dist" \
  -DCMAKE_PREFIX_PATH="$PF" \
  -DSTOP_ON_WARNING=0 \
  -DUSE_PYTHON=OFF \
  -DUSE_QT=OFF \
  -DUSE_LLVM_BITCODE=OFF \
  >> build/logs/cmake-osl.log 2>&1
```

**fmt headers:** Homebrew’s OpenImageIO includes pull in `<fmt/format.h>`. OSL also runs **standalone `clang++` steps** for LLVM bitcode that do not add Homebrew’s `fmt` include path. Export this **for the `ninja install` step** (and keep it in any wrapper script you use):

```bash
export CPATH="$(brew --prefix fmt)/include"
export CPLUS_INCLUDE_PATH="$(brew --prefix fmt)/include"
```

Then:

```bash
ninja -C "$PWD/build/osl-cmake" install >> build/logs/build-osl-install.log 2>&1
```

`-DUSE_LLVM_BITCODE=OFF` skips some embedded bitcode generation; you may still need **`CPATH`** for remaining bitcode targets (for example under `testshade`).

### Generic CMake (no Homebrew)

```bash
mkdir -p build/logs
cmake -S "$PWD/submodules/OpenShadingLanguage" \
  -B "$PWD/build/osl-cmake" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PWD/build/osl-dist" \
  -DSTOP_ON_WARNING=0 \
  >> build/logs/cmake-osl.log 2>&1

cmake --build "$PWD/build/osl-cmake" --target install \
  >> build/logs/build-osl-install.log 2>&1
```

### Link `materialx-osl` to this install

Reconfigure the MaterialX **`materialx-osl`** build so `oslc` / `testrender` paths are **baked in** at compile time:

```bash
cmake -S "$PWD/submodules/MaterialX" -B "$PWD/build/materialx-osl" -G Ninja \
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

Use **`share/OSL/shaders`** for `MATERIALX_OSL_INCLUDE_PATH` so `oslc` finds `stdosl.h` (layout matches a normal `ninja install` into `build/osl-dist`). If your OSL layout differs, point at the directory that contains `stdosl.h`.

Upstream also documents a top-level **`make`** wrapper that produces a `dist/` layout; you can still point MaterialX at whatever directory contains `bin/oslc` and `bin/testrender`.

## Context minimization (log files)

See [building-materialx.md](building-materialx.md): redirect CMake/Ninja output to `build/logs/*.log` so long builds do not flood terminals or LLM sessions.
