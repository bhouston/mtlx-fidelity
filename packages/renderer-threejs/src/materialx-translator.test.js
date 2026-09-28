import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import {
  ClampToEdgeWrapping,
  FileLoader,
  ImageBitmapLoader,
  ImageLoader,
  MirroredRepeatWrapping,
  RepeatWrapping,
} from '../../../submodules/three.js/build/three.webgpu.js';
import { MaterialXLoader } from '../../../submodules/three.js/examples/jsm/loaders/MaterialXLoader.js';
import { createStrictInterfaceValidator } from '../../../submodules/three.js/examples/jsm/loaders/materialx/MaterialXInterfaceValidation.js';
import { createArchiveResolver } from '../../../submodules/three.js/examples/jsm/loaders/materialx/MaterialXArchive.js';
import { MaterialXDocument } from '../../../submodules/three.js/examples/jsm/loaders/materialx/MaterialXDocument.js';
import {
  MaterialXLogCodes,
  MaterialXLog,
} from '../../../submodules/three.js/examples/jsm/loaders/materialx/MaterialXLog.js';
import { parseMaterialXNodeTree } from '../../../submodules/three.js/examples/jsm/loaders/materialx/parse/MaterialXParser.js';

function createDomLikeNode(nodeName, nodeValue) {
  const attributes = {};
  const children = [];

  for (const [key, value] of Object.entries(nodeValue || {})) {
    if (key.startsWith('@_')) {
      attributes[key.slice(2)] = value;
      continue;
    }
    const childNodes = Array.isArray(value) ? value : [value];
    for (const childNodeValue of childNodes) {
      if (childNodeValue === null || typeof childNodeValue !== 'object') continue;
      children.push(createDomLikeNode(key, childNodeValue));
    }
  }

  return {
    nodeName,
    children,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function createDomLikeDocument(text) {
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: false,
  });
  const parsedTree = xmlParser.parse(text);
  const rootNodeName = Object.keys(parsedTree).find((key) => key !== '?xml');
  if (!rootNodeName) {
    throw new Error('DOMParser mock could not locate a root XML element.');
  }
  return {
    documentElement: createDomLikeNode(rootNodeName, parsedTree[rootNodeName]),
  };
}

function readNodeSample(name) {
  return readFileSync(
    new URL(`../../../submodules/mtlx-sample-library/materials/nodes/${name}/${name}.mtlx`, import.meta.url),
    'utf8',
  );
}

function readMaterialSample(relativePath) {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}

function readThreeJsSample(name) {
  return readMaterialSample(`submodules/three.js/examples/materialx/${name}.mtlx`);
}

function errorCodes(result) {
  return (result.errors ?? []).map((error) => error.code);
}

function errorMessages(result) {
  return (result.errors ?? []).map((error) => error.message);
}

describe('vendored three.js MaterialX translator contracts', () => {
  const originalDOMParser = globalThis.DOMParser;
  let imageLoaderLoadSpy;
  let imageBitmapLoaderLoadSpy;

  beforeAll(() => {
    globalThis.DOMParser = class DOMParserMock {
      parseFromString(text) {
        return createDomLikeDocument(text);
      }
    };
    imageLoaderLoadSpy = vi.spyOn(ImageLoader.prototype, 'load').mockImplementation(function (_url, onLoad) {
      onLoad?.({});
      return this;
    });
    imageBitmapLoaderLoadSpy = vi
      .spyOn(ImageBitmapLoader.prototype, 'load')
      .mockImplementation(function (_url, onLoad) {
        onLoad?.({});
        return this;
      });
  });

  afterAll(() => {
    globalThis.DOMParser = originalDOMParser;
    imageLoaderLoadSpy?.mockRestore();
    imageBitmapLoaderLoadSpy?.mockRestore();
  });

  it('parses xml-like tree into a typed tree shape', () => {
    class FakeNode {
      constructor(nodeXML, nodePath) {
        this.children = [];
        this.nodeXML = nodeXML;
        this.name = nodeXML.getAttribute('name') ?? nodeXML.nodeName;
        this.nodePath = nodePath ? `${nodePath}/${this.name}` : this.name;
      }

      add(node) {
        this.children.push(node);
      }
    }

    const xmlTree = {
      nodeName: 'materialx',
      getAttribute: () => null,
      children: [
        {
          nodeName: 'nodegraph',
          getAttribute: (name) => (name === 'name' ? 'graph' : null),
          children: [
            {
              nodeName: 'image',
              getAttribute: (name) => (name === 'name' ? 'albedo' : null),
              children: [
                {
                  nodeName: 'input',
                  getAttribute: (name) => {
                    if (name === 'name') return 'file';
                    if (name === 'value') return 'foo.png';
                    return null;
                  },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const indexed = new Map();
    const root = parseMaterialXNodeTree(
      xmlTree,
      (nodeXML, nodePath) => new FakeNode(nodeXML, nodePath),
      (node) => indexed.set(node.nodePath, node),
    );

    expect(root.nodePath).toBe('materialx');
    expect(indexed.has('materialx/graph/albedo/file')).toBe(true);
  });

  it('collects MaterialX log errors via add', () => {
    const log = new MaterialXLog();
    log.add(
      MaterialXLogCodes.UNSUPPORTED_NODE,
      'Unsupported MaterialX node category "unknown_node" on "nodeA".',
      'nodeA',
    );
    log.add(MaterialXLogCodes.INVALID_VALUE, 'bad value', 'nodeA');
    expect(log.errors).toHaveLength(2);
  });

  it('throws from MaterialXLoader when throwOnErrors is enabled', () => {
    const unsupportedSurfaceMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <future_surface name="future_surface_1" />
  <surfacematerial name="mat_unsupported">
    <input name="surfaceshader" nodename="future_surface_1" />
  </surfacematerial>
</materialx>`;

    const loader = new MaterialXLoader();
    expect(() => loader.parseBuffer(unsupportedSurfaceMtlx, 'unsupported.mtlx', { throwOnErrors: true })).toThrow(
      /MaterialX translation failed with \d+ error\(s\)/,
    );
  });

  it('keeps callback load API behavior intact', async () => {
    const setPathSpy = vi.spyOn(FileLoader.prototype, 'setPath').mockReturnThis();
    const setResponseTypeSpy = vi.spyOn(FileLoader.prototype, 'setResponseType').mockReturnThis();
    const fileLoadSpy = vi.spyOn(FileLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
      onLoad('xml payload');
      return this;
    });
    const loader = new MaterialXLoader().setPath('/assets/');
    // `load()` now calls the internal `_parseBuffer` directly (not the public `parseBuffer`),
    // then awaits `document.waitForResources()` before invoking `onLoad`.
    const parseBufferSpy = vi.spyOn(loader, '_parseBuffer').mockReturnValue({
      document: { waitForResources: () => Promise.resolve() },
      log: { errors: [], warnings: [] },
      result: { parsed: true },
    });

    try {
      const onLoad = await new Promise((resolve) => {
        loader.load('material.mtlx', resolve);
      });

      expect(setPathSpy).toHaveBeenCalledWith('/assets/');
      expect(setResponseTypeSpy).toHaveBeenCalledWith('arraybuffer');
      expect(fileLoadSpy).toHaveBeenCalledWith('material.mtlx', expect.any(Function), undefined, expect.any(Function));
      expect(parseBufferSpy).toHaveBeenCalledWith('xml payload', 'material.mtlx', {});
      // `load()` mutates the parsed result, attaching `.errors`/`.warnings` from the log
      // before calling `onLoad`.
      expect(onLoad).toEqual({ parsed: true, errors: [], warnings: [] });
    } finally {
      setPathSpy.mockRestore();
      setResponseTypeSpy.mockRestore();
      fileLoadSpy.mockRestore();
    }
  });

  it('configures MaterialX UV-space helpers from loader options', () => {
    const defaultDocument = new MaterialXDocument(undefined, '', new MaterialXLog());
    const uvNode = {};

    expect(defaultDocument.uvSpace).toBe('bottom-left');
    expect(defaultDocument.compileContext.mxToBottomLeftUvSpace(uvNode)).toBe(uvNode);
    expect(defaultDocument.compileContext.mxFromBottomLeftUvSpace(uvNode)).toBe(uvNode);
    expect(defaultDocument.compileContext.mxToUvSpace).toBeUndefined();
    expect(defaultDocument.compileContext.mxFromUvSpace).toBeUndefined();

    const topLeftDocument = new MaterialXDocument(undefined, '', new MaterialXLog(), null, 'top-left');
    expect(topLeftDocument.uvSpace).toBe('top-left');
    expect(topLeftDocument.compileContext.mxToBottomLeftUvSpace).not.toBe(
      defaultDocument.compileContext.mxToBottomLeftUvSpace,
    );
    expect(topLeftDocument.compileContext.mxFromBottomLeftUvSpace).not.toBe(
      defaultDocument.compileContext.mxFromBottomLeftUvSpace,
    );

    const loader = new MaterialXLoader();
    expect(() =>
      loader.parseBuffer('<materialx version="1.38" />', 'material.mtlx', { uvSpace: 'upper-left' }),
    ).toThrow(/Unsupported MaterialX uvSpace/);
  });

  it('maps image address modes to texture wrapping per axis', () => {
    const document = new MaterialXDocument({ getHandler: () => null }, '', new MaterialXLog());
    document.textureLoader.load = vi.fn();
    document.parseNode(
      createDomLikeDocument(`
<materialx version="1.38">
  <nodegraph name="graph">
    <image name="image1" type="color3">
      <input name="file" type="filename" value="textures/checker.png" />
      <input name="uaddressmode" type="string" value="clamp" />
      <input name="vaddressmode" type="string" value="mirror" />
    </image>
    <image name="image2" type="color3">
      <input name="file" type="filename" value="textures/checker.png" />
      <input name="uaddressmode" type="string" value="periodic" />
      <input name="vaddressmode" type="string" value="constant" />
    </image>
  </nodegraph>
</materialx>`).documentElement,
    );

    // getTexture() now returns a TSL texture() node wrapping the THREE.Texture rather than
    // the Texture itself; the wrap modes live on its `.value`.
    const firstTextureNode = document.getMaterialXNode('graph/image1/file').getTexture();
    const secondTextureNode = document.getMaterialXNode('graph/image2/file').getTexture();

    expect(firstTextureNode.value.wrapS).toBe(ClampToEdgeWrapping);
    expect(firstTextureNode.value.wrapT).toBe(MirroredRepeatWrapping);
    expect(secondTextureNode.value.wrapS).toBe(RepeatWrapping);
    expect(secondTextureNode.value.wrapT).toBe(ClampToEdgeWrapping);
    expect(secondTextureNode.value).not.toBe(firstTextureNode.value);
  });

  it('supports loadAsync options and propagates load errors', async () => {
    const loader = new MaterialXLoader();
    const loadSpy = vi.spyOn(loader, 'load');
    const resolvedMaterial = { material: true };
    const options = { throwOnErrors: true };
    loadSpy.mockImplementationOnce((url, onLoad) => {
      onLoad(resolvedMaterial);
      return loader;
    });
    await expect(loader.loadAsync('ok.mtlx', options)).resolves.toBe(resolvedMaterial);
    expect(loadSpy).toHaveBeenCalledWith('ok.mtlx', expect.any(Function), undefined, expect.any(Function), options);

    const loadFailure = new Error('load failed');
    loadSpy.mockImplementationOnce((url, onLoad, onProgress, onError) => {
      onError(loadFailure);
      return loader;
    });
    await expect(loader.loadAsync('broken.mtlx')).rejects.toThrow('load failed');
  });

  it('parses implicit boolean-to-float connections without surfacing strict validation issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readNodeSample('convert_invalid_implicit_boolean_to_float'),
      'convert_invalid_implicit_boolean_to_float.mtlx',
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['M_convert_invalid_implicit_boolean_to_float']);
    expect(result.errors).toEqual([]);
  });

  it('parses implicit float-to-boolean connections without surfacing strict validation issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readNodeSample('convert_invalid_implicit_float_to_boolean'),
      'convert_invalid_implicit_float_to_boolean.mtlx',
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['M_convert_invalid_implicit_float_to_boolean']);
    expect(result.errors).toEqual([]);
  });

  it('parses artistic_ior helper nodes without surfacing issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(readNodeSample('artistic_ior'), 'artistic_ior.mtlx');

    expect(Object.keys(result.materials ?? {})).toEqual(['M_artistic_ior']);
    expect(result.errors).toEqual([]);
  });

  it('parses artistic_ior multioutput nodegraphs, warning about the missing luminance lumacoeffs default', () => {
    // Known nodedef-defaults gap in mrdoob/three.js#34593: the vendored nodedef registry
    // (MaterialXNodeInterfaceRegistry.js) only defines ND_luminance_color3/color4, so a
    // <luminance type="float"> node (as used by this sample's "ior_luma"/"ext_luma" nodes)
    // resolves to no nodedef at all, and MaterialXCompileRegistry.js falls back to 0 for the
    // missing "lumacoeffs" input instead of the standard Rec.709 luma coefficients declared
    // for the color3/color4 variants. Worth reporting upstream. Production usage
    // (packages/renderer-threejs/viewer/src/main.tsx) passes throwOnErrors: false and treats
    // this as a recoverable issue, so this test matches that configuration.
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readMaterialSample(
        'submodules/mtlx-sample-library/materials/surfaces/standard_surface/showcase_graph_pbr_helpers/showcase_graph_pbr_helpers.mtlx',
      ),
      'showcase_graph_pbr_helpers.mtlx',
      { throwOnErrors: false },
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['showcase_graph_pbr_helpers']);
    // The missing-default entries are logged with `INVALID_VALUE` severity, which is always
    // 'error' (see MaterialXLog.js) regardless of throwOnErrors, so they land in `.errors`
    // rather than `.warnings` even though translation still succeeds with a fallback value.
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-value',
          message: expect.stringContaining('Missing input "lumacoeffs"'),
        }),
      ]),
    );
    expect(result.warnings ?? []).toEqual([]);
  });

  it('parses switch node samples without surfacing unsupported-node issues', () => {
    const loader = new MaterialXLoader();
    const switchSamples = ['switch', 'switch_float_floor_clamp', 'switch_integer_zero_based'];

    for (const sample of switchSamples) {
      const result = loader.parseBuffer(readNodeSample(sample), `${sample}.mtlx`);
      expect(Object.keys(result.materials ?? {})).toEqual([`M_${sample}`]);
      expect(result.errors).toEqual([]);
    }
  });

  it('records unsupported nodes and missing references without throwing by default', () => {
    const unsupportedSurfaceMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <future_surface name="future_surface_1" />
  <surfacematerial name="mat_unsupported">
    <input name="surfaceshader" nodename="future_surface_1" />
  </surfacematerial>
</materialx>`;

    const missingReferenceMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <surfacematerial name="mat_missing_ref">
    <input name="surfaceshader" nodename="does_not_exist" />
  </surfacematerial>
</materialx>`;

    const warnLoader = new MaterialXLoader();
    const unsupportedWarnResult = warnLoader.parseBuffer(unsupportedSurfaceMtlx, 'unsupported.mtlx', {
      throwOnErrors: false,
    });
    expect(unsupportedWarnResult.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported-node' })]),
    );

    const missingWarnResult = warnLoader.parseBuffer(missingReferenceMtlx, 'missing-ref.mtlx', {
      throwOnErrors: false,
    });
    expect(missingWarnResult.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing-reference', nodeName: 'surfaceshader' })]),
    );

    const strictLoader = new MaterialXLoader();
    expect(() => strictLoader.parseBuffer(unsupportedSurfaceMtlx, 'unsupported.mtlx', { throwOnErrors: true })).toThrow(
      /MaterialX translation failed with \d+ error\(s\)/,
    );
    expect(() => strictLoader.parseBuffer(missingReferenceMtlx, 'missing-ref.mtlx', { throwOnErrors: true })).toThrow(
      /MaterialX translation failed with \d+ error\(s\)/,
    );
  });

  it('supports missing material failure path via loader options', () => {
    const materialMtlx = `<?xml version="1.0"?>
<materialx version="1.38">
  <standard_surface name="std_surface" />
  <surfacematerial name="mat_present">
    <input name="surfaceshader" nodename="std_surface" />
  </surfacematerial>
</materialx>`;

    const warnLoader = new MaterialXLoader();
    const warnResult = warnLoader.parseBuffer(materialMtlx, 'missing-material.mtlx', {
      materialName: 'mat_missing',
      throwOnErrors: false,
    });
    expect(warnResult.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing-material' })]));

    const strictLoader = new MaterialXLoader();
    expect(() =>
      strictLoader.parseBuffer(materialMtlx, 'missing-material.mtlx', {
        throwOnErrors: true,
        materialName: 'mat_missing',
      }),
    ).toThrow(/MaterialX translation failed with \d+ error\(s\)/);
  });

  it('revokes archive object urls on resolver dispose', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const resolver = createArchiveResolver(new Map([['textures/test.png', new Uint8Array([1, 2, 3])]]));
      expect(resolver.resolve('textures/test.png')).toBe('blob:test-url');
      resolver.dispose();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  // oxlint-disable-next-line vitest/no-disabled-tests
  it('does not run strict interface validation unless explicitly enabled', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(readThreeJsSample('standard_surface_rotate2d_test'), 'rotate2d.mtlx');

    expect(errorCodes(result).filter((code) => code === 'unknown-input')).toEqual([]);
    expect(errorCodes(result).filter((code) => code === 'invalid-output-connection')).toEqual([]);
  });

  // oxlint-disable-next-line vitest/no-disabled-tests
  it('reports unknown nodedef inputs, invalid output wiring, and type mismatches', () => {
    // The shared submodule fixtures under submodules/three.js/examples/materialx/ were cleaned
    // up (see three.js commit "remove non-standard MAterialX alias support and update .mtlx
    // files to use proper ports names") to use standard MaterialX port names/wiring, so they no
    // longer contain the deliberately-invalid inputs this test exercises. That cleanup is
    // legitimate (the fixtures are now spec-compliant), so instead of relying on the shared
    // fixtures, this test uses inline snippets that reproduce the previous, deliberately-invalid
    // wiring to confirm the strict interface validator still catches these cases.
    const loader = new MaterialXLoader();
    const strictValidate = createStrictInterfaceValidator();
    const texturePath = 'submodules/three.js/examples/materialx/';
    const strictOptions = { interfaceValidator: strictValidate, path: texturePath, throwOnErrors: false };

    const rotate2dMtlx = `<?xml version="1.0"?>
<materialx version="1.39">
  <surfacematerial name="mat_rotate2d_test" type="material" nodedef="ND_surfacematerial">
    <input name="surfaceshader" type="surfaceshader" nodename="surface_shader1" />
  </surfacematerial>
  <standard_surface name="surface_shader1" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader">
    <input name="base_color" type="color3" output="out" nodegraph="rotate2d_test" />
  </standard_surface>
  <nodegraph name="rotate2d_test">
    <texcoord name="texcoord1" type="vector2" />
    <rotate2d name="rotate2d_1" type="vector2">
      <input name="in" type="vector2" nodename="texcoord1" />
      <input name="amount" type="float" value="45.0" unittype="angle" unit="degree" />
      <input name="pivot" type="vector2" value="0.5, 0.5" />
    </rotate2d>
    <image name="rotated_image" type="color3">
      <input name="file" type="filename" value="resources/Images/grid.png" />
      <input name="default" type="color3" value="0.5, 0.5, 0.5" />
      <input name="texcoord" type="vector2" nodename="rotate2d_1" />
    </image>
    <output name="out" type="color3" nodename="rotated_image" />
  </nodegraph>
</materialx>`;
    const rotate2dResult = loader.parseBuffer(rotate2dMtlx, 'rotate2d.mtlx', strictOptions);
    expect(errorCodes(rotate2dResult)).toContain('unknown-input');
    expect(errorMessages(rotate2dResult).some((message) => message.includes("Input 'pivot'"))).toBe(true);

    const rotate3dMtlx = `<?xml version="1.0"?>
<materialx version="1.39">
  <surfacematerial name="mat_rotate2d_test" type="material" nodedef="ND_surfacematerial">
    <input name="surfaceshader" type="surfaceshader" nodename="surface_shader1" />
  </surfacematerial>
  <standard_surface name="surface_shader1" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader">
    <input name="base_color" type="color3" output="out" nodegraph="rotate2d_test" />
  </standard_surface>
  <nodegraph name="rotate2d_test">
    <texcoord name="texcoord1" type="vector2" />
    <separate2 name="separate_texcoord" type="vector2">
      <input name="in" type="vector2" nodename="texcoord1" />
    </separate2>
    <combine3 name="texcoord_3d" type="vector3">
      <input name="in1" type="float" nodename="separate_texcoord" output="x" />
      <input name="in2" type="float" nodename="separate_texcoord" output="y" />
      <input name="in3" type="float" value="0.0" />
    </combine3>
    <time name="time1" type="float" />
    <multiply name="multiply1" type="float">
      <input name="in1" type="float" nodename="time1" />
      <input name="in2" type="float" value="10.0" />
    </multiply>
    <rotate3d name="rotate3d_1" type="vector3">
      <input name="in" type="vector3" nodename="texcoord_3d" />
      <input name="amount" type="float" nodename="multiply1" />
      <input name="axis" type="vector3" value="0.0, 0.0, 1.0" />
    </rotate3d>
    <separate3 name="separate_rotated" type="vector3">
      <input name="in" type="vector3" nodename="rotate3d_1" />
    </separate3>
    <combine3 name="rotated_texcoord" type="vector3">
      <input name="in1" type="float" nodename="separate_rotated" output="x" />
      <input name="in2" type="float" nodename="separate_rotated" output="y" />
      <input name="in3" type="float" nodename="separate_rotated" output="z" />
    </combine3>
    <image name="rotated_image" type="color3">
      <input name="file" type="filename" value="resources/Images/grid.png" />
      <input name="default" type="color3" value="0.5, 0.5, 0.5" />
      <input name="texcoord" type="vector2" nodename="rotated_texcoord" />
    </image>
    <output name="out" type="color3" nodename="rotated_image" />
  </nodegraph>
</materialx>`;
    const rotate3dResult = loader.parseBuffer(rotate3dMtlx, 'rotate3d.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(
      errorCodes(rotate3dResult).filter((code) => code === 'invalid-output-connection').length,
    ).toBeGreaterThanOrEqual(2);

    const colorCmMtlx = `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <surfacematerial name="mat_color3_vec3_cm_test" type="material" nodedef="ND_surfacematerial">
    <input name="surfaceshader" type="surfaceshader" nodename="surface_shader1" />
  </surfacematerial>
  <standard_surface name="surface_shader1" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader">
    <input name="base_color" type="color3" output="out" nodegraph="normalmap_cm" />
  </standard_surface>
  <nodegraph name="normalmap_cm">
    <image name="b_image" type="color3">
      <input name="file" type="filename" value="resources/Images/grid.png" colorspace="srgb_texture" />
    </image>
    <convert name="c3tov3" type="vector3">
      <input name="in" type="color3" nodename="b_image" />
    </convert>
    <normalmap name="impl_normalmap" type="vector3">
      <input name="in" type="vector3" nodename="c3tov3" />
      <input name="scale" type="float" value="1.5" />
    </normalmap>
    <output name="out" type="vector3" nodename="impl_normalmap" />
  </nodegraph>
</materialx>`;
    const colorCmResult = loader.parseBuffer(colorCmMtlx, 'color3_vec3_cm.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(errorCodes(colorCmResult)).toContain('type-mismatch');
    expect(errorMessages(colorCmResult).some((message) => message.includes('base_color'))).toBe(true);

    const combinedMtlx = `<?xml version="1.0"?>
<materialx version="1.39">
  <surfacematerial name="mat_combined_test" type="material" nodedef="ND_surfacematerial">
    <input name="surfaceshader" type="surfaceshader" nodename="surface_shader1" />
  </surfacematerial>
  <standard_surface name="surface_shader1" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader">
    <input name="base_color" type="color3" value="0.6, 0.8, 0.4" />
    <input name="opacity" type="float" value="0.7" />
    <input name="specular" type="float" value="0.9" />
    <input name="specular_color" type="color3" value="0.8, 1.0, 0.8" />
    <input name="ior" type="float" value="1.8" />
    <input name="specular_roughness" type="float" value="0.1" />
    <input name="metalness" type="float" value="0.0" />
  </standard_surface>
</materialx>`;
    const combinedResult = loader.parseBuffer(combinedMtlx, 'combined.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(errorCodes(combinedResult)).toContain('unknown-input');
    expect(errorMessages(combinedResult).some((message) => message.includes("Input 'opacity'"))).toBe(true);

    const roughnessMtlx = `<?xml version="1.0"?>
<materialx version="1.39">
  <surfacematerial name="mat_roughness_test" type="material" nodedef="ND_surfacematerial">
    <input name="surfaceshader" type="surfaceshader" nodename="surface_shader1" />
  </surfacematerial>
  <standard_surface name="surface_shader1" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader">
    <input name="base_color" type="color3" value="0.8, 0.8, 0.8" />
    <input name="roughness" type="float" output="out" nodegraph="roughness_map" />
  </standard_surface>
  <nodegraph name="roughness_map">
    <image name="roughness_image" type="float">
      <input name="file" type="filename" value="resources/Images/grid.png" />
      <input name="default" type="float" value="0.5" />
    </image>
    <output name="out" type="float" nodename="roughness_image" />
  </nodegraph>
</materialx>`;
    const roughnessResult = loader.parseBuffer(roughnessMtlx, 'roughness.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(errorCodes(roughnessResult)).toContain('unknown-input');
    expect(errorMessages(roughnessResult).some((message) => message.includes("Input 'roughness'"))).toBe(true);

    const iorMtlx = `<?xml version="1.0"?>
<materialx version="1.39">
  <surfacematerial name="mat_ior_test" type="material" nodedef="ND_surfacematerial">
    <input name="surfaceshader" type="surfaceshader" nodename="surface_shader1" />
  </surfacematerial>
  <standard_surface name="surface_shader1" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader">
    <input name="base_color" type="color3" value="0.9, 0.9, 0.9" />
    <input name="ior" type="float" value="2.4" />
    <input name="specular_roughness" type="float" value="0.0" />
    <input name="metalness" type="float" value="0.0" />
  </standard_surface>
</materialx>`;
    const iorResult = loader.parseBuffer(iorMtlx, 'ior.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(errorCodes(iorResult)).toContain('unknown-input');
    expect(errorMessages(iorResult).some((message) => message.includes("Input 'ior'"))).toBe(true);
  });

  it('clears archive resources at parse boundaries and dispose', () => {
    const loader = new MaterialXLoader();
    const archiveDisposer = vi.fn();
    loader.archiveDisposer = archiveDisposer;
    vi.spyOn(loader, 'parse').mockReturnValue({});

    loader.parseBuffer('<materialx/>', 'plain.mtlx');
    expect(archiveDisposer).toHaveBeenCalledTimes(1);

    const nextArchiveDisposer = vi.fn();
    loader.archiveDisposer = nextArchiveDisposer;
    loader.dispose();
    expect(nextArchiveDisposer).toHaveBeenCalledTimes(1);
  });
});
