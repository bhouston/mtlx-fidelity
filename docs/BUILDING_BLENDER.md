# Building Blender Locally

This repository vendors the patched Blender checkout as `submodules/blender`.
Build outputs should stay in the ignored repo-local directory:

```bash
build/blender
```

The `blender-nodes` and `blender-eevee-nodes` renderers automatically prefer:

```bash
build/blender/bin/Blender.app/Contents/MacOS/Blender
```

You can still override this with `BLENDER_NODES_EXECUTABLE`.

## Precompiled libraries (`lib/macos_arm64`)

CMake expects `submodules/blender/lib/macos_arm64` (see Blender’s build handbook). Populate it either:

- run `make update` from `submodules/blender` (downloads the official precompiled libs), or
- point `submodules/blender/lib/macos_arm64` at another checkout that already has those libs (symlink is fine for local use).

## Xcode Environment

The local build is sensitive to which Xcode and macOS SDK are used. The default `/Applications/Xcode.app` may not work for this checkout. Use the custom installed Xcode instead:

```bash
export DEVELOPER_DIR="/Applications/Xcode-26.1.1.app/Contents/Developer"
export SDKROOT="$DEVELOPER_DIR/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk"
```

## One-Time Configure

Run from the material-fidelity repository root.

Blender’s CMake initializes **`CMAKE_BUILD_TYPE`** to **`Release`** when unset, so the default configure is an **optimized** build. You can still pass **`-DCMAKE_BUILD_TYPE=Release`** or **`-DCMAKE_BUILD_TYPE=Debug`** explicitly.

```bash
DEVELOPER_DIR="/Applications/Xcode-26.1.1.app/Contents/Developer" \
SDKROOT="/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk" \
cmake -S "$PWD/submodules/blender" \
  -B "$PWD/build/blender" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_SYSROOT="/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk"
```

The expected configure output should detect:

```text
Xcode 26.1.1 at /Applications/Xcode-26.1.1.app/Contents/Developer
OSX_SYSROOT: /Applications/Xcode-26.1.1.app/.../MacOSX26.1.sdk
```

## Build

Use Ninja with the same Xcode environment:

```bash
DEVELOPER_DIR="/Applications/Xcode-26.1.1.app/Contents/Developer" \
SDKROOT="/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk" \
ninja -C "$PWD/build/blender" -j 4
```

Higher parallelism may work, but `-j 4` is known to avoid local process-limit failures.

After the link step completes, run **`ninja install` once** so libraries (for example OSL) are copied into `Blender.app/Contents/Resources`. Without install, the binary in `MacOS/` may fail at launch with missing `@rpath` dylibs.

## Install App Bundle

To build and install the app bundle:

```bash
DEVELOPER_DIR="/Applications/Xcode-26.1.1.app/Contents/Developer" \
SDKROOT="/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk" \
ninja -C "$PWD/build/blender" -j 4 install
```

The built executable used by local tooling is:

```bash
build/blender/bin/Blender.app/Contents/MacOS/Blender
```

## Context minimization (log files)

CMake and Ninja emit enormous output (often tens of thousands of lines). In Cursor or other LLM-assisted workflows, streaming that into the chat wastes context on boilerplate and hides real errors.

**Strategy:** write full output to files under `build/logs/` (gitignored via `/build/`), and only paste short excerpts when something fails.

1. **Redirect stdout and stderr together** so nothing floods the terminal:

   ```bash
   mkdir -p build/logs
   DEVELOPER_DIR="..." SDKROOT="..." \
     cmake -S "$PWD/submodules/blender" -B "$PWD/build/blender" -G Ninja ... \
     >> build/logs/cmake-blender.log 2>&1
   DEVELOPER_DIR="..." SDKROOT="..." \
     ninja -C "$PWD/build/blender" -j 4 >> build/logs/ninja-blender.log 2>&1
   DEVELOPER_DIR="..." SDKROOT="..." \
     ninja -C "$PWD/build/blender" -j 4 install >> build/logs/ninja-blender-install.log 2>&1
   ```

2. **On failure, inspect the tail** instead of re-running with verbose output in the foreground:

   ```bash
   tail -80 build/logs/ninja-blender.log
   ```

3. **Long builds:** run Ninja in the background and poll for completion or for `build/blender/bin/Blender.app/Contents/MacOS/Blender`, then read logs only if the exit code is non-zero.

4. **Optional:** set `NINJA_STATUS` to shorten Ninja’s per-line status (lines still add up; logging remains the main fix):

   ```bash
   export NINJA_STATUS="[%f/%t] "
   ```

## Useful Focused Targets

Compile the MaterialX noise shader node unity object:

```bash
DEVELOPER_DIR="/Applications/Xcode-26.1.1.app/Contents/Developer" \
SDKROOT="/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk" \
ninja -C "$PWD/build/blender" \
  "source/blender/nodes/shader/CMakeFiles/bf_nodes_shader.dir/Unity/unity_7_cxx.cxx.o" \
  -j 4
```

Generate the MaterialX noise GLSL and OSL artifacts:

```bash
DEVELOPER_DIR="/Applications/Xcode-26.1.1.app/Contents/Developer" \
SDKROOT="/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk" \
ninja -C "$PWD/build/blender" \
  "source/blender/gpu/shaders/material/gpu_shader_material_tex_mx_noise.glsl.hh" \
  "intern/cycles/kernel/osl/shaders/node_mx_noise_texture.oso" \
  -j 4
```

## Troubleshooting

If the build reports Metal SDK availability errors such as `MTL4CommandQueue`, `MTLResourceID`, or `MTLMotionBorderMode`, verify the build cache is not using `/Applications/Xcode.app`:

```bash
grep CMAKE_OSX_SYSROOT build/blender/CMakeCache.txt
```

It should point to:

```text
/Applications/Xcode-26.1.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk
```

If it points at `/Applications/Xcode.app`, rerun the configure command above.
