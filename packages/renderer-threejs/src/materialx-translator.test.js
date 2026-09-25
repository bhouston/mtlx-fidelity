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
    new URL(`../../../submodules/material-samples/materials/nodes/${name}/${name}.mtlx`, import.meta.url),
    'utf8',
  );
}

function readMaterialSample(relativePath) {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}

function readThreeJsSample(name) {
  return readMaterialSample(`submodules/material-samples/materials/threejs/${name}/${name}.mtlx`);
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

  it('keeps callback load API behavior intact', () => {
    const setPathSpy = vi.spyOn(FileLoader.prototype, 'setPath').mockReturnThis();
    const setResponseTypeSpy = vi.spyOn(FileLoader.prototype, 'setResponseType').mockReturnThis();
    const fileLoadSpy = vi.spyOn(FileLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
      onLoad('xml payload');
      return this;
    });
    const loader = new MaterialXLoader().setPath('/assets/');
    const parseBufferSpy = vi.spyOn(loader, 'parseBuffer').mockReturnValue({ parsed: true });
    const onLoad = vi.fn();

    try {
      loader.load('material.mtlx', onLoad);
      expect(setPathSpy).toHaveBeenCalledWith('/assets/');
      expect(setResponseTypeSpy).toHaveBeenCalledWith('arraybuffer');
      expect(fileLoadSpy).toHaveBeenCalledWith('material.mtlx', expect.any(Function), undefined, expect.any(Function));
      expect(parseBufferSpy).toHaveBeenCalledWith('xml payload', 'material.mtlx', {});
      expect(onLoad).toHaveBeenCalledWith({ parsed: true });
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

    const firstTexture = document.getMaterialXNode('graph/image1/file').getTexture();
    const secondTexture = document.getMaterialXNode('graph/image2/file').getTexture();

    expect(firstTexture.wrapS).toBe(ClampToEdgeWrapping);
    expect(firstTexture.wrapT).toBe(MirroredRepeatWrapping);
    expect(secondTexture.wrapS).toBe(RepeatWrapping);
    expect(secondTexture.wrapT).toBe(ClampToEdgeWrapping);
    expect(secondTexture).not.toBe(firstTexture);
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

  it('parses artistic_ior multioutput nodegraphs without surfacing issues', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(
      readMaterialSample(
        'submodules/material-samples/materials/surfaces/standard_surface/showcase_graph_pbr_helpers/showcase_graph_pbr_helpers.mtlx',
      ),
      'showcase_graph_pbr_helpers.mtlx',
    );

    expect(Object.keys(result.materials ?? {})).toEqual(['showcase_graph_pbr_helpers']);
    expect(result.errors).toEqual([]);
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

  it('does not run strict interface validation unless explicitly enabled', () => {
    const loader = new MaterialXLoader();
    const result = loader.parseBuffer(readThreeJsSample('standard_surface_rotate2d_test'), 'rotate2d.mtlx');

    expect(errorCodes(result).filter((code) => code === 'unknown-input')).toEqual([]);
    expect(errorCodes(result).filter((code) => code === 'invalid-output-connection')).toEqual([]);
  });

  it('reports unknown nodedef inputs, invalid output wiring, and type mismatches', () => {
    const loader = new MaterialXLoader();
    const strictValidate = createStrictInterfaceValidator();
    const texturePath = 'submodules/material-samples/materials/threejs/standard_surface_rotate2d_test/';
    const strictOptions = { interfaceValidator: strictValidate, path: texturePath, throwOnErrors: false };

    const rotate2dResult = loader.parseBuffer(
      readThreeJsSample('standard_surface_rotate2d_test'),
      'rotate2d.mtlx',
      strictOptions,
    );
    expect(errorCodes(rotate2dResult)).toContain('unknown-input');
    expect(errorMessages(rotate2dResult).some((message) => message.includes("Input 'pivot'"))).toBe(true);

    const rotate3dResult = loader.parseBuffer(readThreeJsSample('standard_surface_rotate3d_test'), 'rotate3d.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(
      errorCodes(rotate3dResult).filter((code) => code === 'invalid-output-connection').length,
    ).toBeGreaterThanOrEqual(2);

    const colorCmResult = loader.parseBuffer(
      readThreeJsSample('standard_surface_color3_vec3_cm_test'),
      'color3_vec3_cm.mtlx',
      { interfaceValidator: strictValidate, throwOnErrors: false },
    );
    expect(errorCodes(colorCmResult)).toContain('type-mismatch');
    expect(errorMessages(colorCmResult).some((message) => message.includes('base_color'))).toBe(true);

    const combinedResult = loader.parseBuffer(readThreeJsSample('standard_surface_combined_test'), 'combined.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(errorCodes(combinedResult)).toContain('unknown-input');
    expect(errorMessages(combinedResult).some((message) => message.includes("Input 'opacity'"))).toBe(true);

    const roughnessResult = loader.parseBuffer(readThreeJsSample('standard_surface_roughness_test'), 'roughness.mtlx', {
      interfaceValidator: strictValidate,
      throwOnErrors: false,
    });
    expect(errorCodes(roughnessResult)).toContain('unknown-input');
    expect(errorMessages(roughnessResult).some((message) => message.includes("Input 'roughness'"))).toBe(true);

    const iorResult = loader.parseBuffer(readThreeJsSample('standard_surface_ior_test'), 'ior.mtlx', {
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
