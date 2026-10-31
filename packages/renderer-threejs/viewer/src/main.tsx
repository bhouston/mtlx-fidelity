import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MaterialXLoader } from 'three/addons/loaders/MaterialXLoader.js';

declare global {
  var __MTLX_CAPTURE_DONE__: boolean | undefined;
  var __MTLX_CAPTURE_ERROR__: string | undefined;
  var __MTLX_MATERIALX_LOG__: MaterialXLogEntry[] | undefined;
  var __MTLX_FORCE_RENDER__: (() => void) | undefined;
  var __MTLX_DISPOSE_SCENE__: (() => void) | undefined;
}

const querySchema = z.object({
  mtlxPath: z.string().min(1),
  modelPath: z.string().min(1),
  environmentHdrPath: z.string().min(1),
  environmentRotationDegrees: z.coerce.number().default(0),
  backgroundColor: z.string().transform((value, context) => {
    const pieces = value.split(',').map((piece) => Number(piece.trim()));
    if (pieces.length !== 3 || pieces.some((piece) => Number.isNaN(piece) || piece < 0 || piece > 1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected backgroundColor as "r,g,b" with values in [0,1].',
      });
      return z.NEVER;
    }

    return [pieces[0], pieces[1], pieces[2]] as const;
  }),
  materialXLoaderVariant: z.enum(['custom', 'official']).default('custom'),
  interfaceValidatorPath: z.string().optional(),
});

type ViewerQuery = z.infer<typeof querySchema>;
const IDEAL_MESH_SPHERE_RADIUS = 2;
const REFERENCE_IMAGE_WIDTH = 512;
const REFERENCE_IMAGE_HEIGHT = 512;

type ThreeMaterialXLoaderResult = {
  materials?: Record<string, THREE.Material>;
  material?: THREE.Material;
  log?: MaterialXLogEntry[];
  errors?: MaterialXLogEntry[];
  warnings?: MaterialXLogEntry[];
};

type MaterialXLogEntry = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeName?: string;
};

type MaterialXLoaderLike = {
  setPath: (path: string) => MaterialXLoaderLike;
  loadAsync: (path: string, onProgressOrOptions?: unknown, options?: unknown) => Promise<ThreeMaterialXLoaderResult>;
  dispose?: () => void;
};

type StrictInterfaceValidationModule = {
  createStrictInterfaceValidator?: () => unknown;
};

function isMaterialXLogEntry(candidate: unknown): candidate is MaterialXLogEntry {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const value = candidate as Record<string, unknown>;
  return (
    typeof value.code === 'string' &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.message === 'string' &&
    (value.nodeName === undefined || typeof value.nodeName === 'string')
  );
}

function readMaterialXLog(candidate: unknown): MaterialXLogEntry[] {
  if (!candidate || typeof candidate !== 'object') {
    return [];
  }

  const value = candidate as { log?: unknown; errors?: unknown; warnings?: unknown };
  if (Array.isArray(value.log)) {
    return value.log.filter(isMaterialXLogEntry);
  }

  return [value.errors, value.warnings].flatMap((entries) =>
    Array.isArray(entries) ? entries.filter(isMaterialXLogEntry) : [],
  );
}

function parseQuery(search: string): ViewerQuery {
  const rawQuery = Object.fromEntries(new URLSearchParams(search).entries());
  return querySchema.parse(rawQuery);
}

function firstMaterial(candidate: unknown): THREE.Material | undefined {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }

  const value = candidate as Record<string, unknown>;
  const materialsObject = value.materials;
  if (materialsObject && typeof materialsObject === 'object') {
    const materials = Object.values(materialsObject as Record<string, unknown>);
    const lastMaterial = materials.at(-1);
    if (lastMaterial && typeof lastMaterial === 'object' && (lastMaterial as { isMaterial?: boolean }).isMaterial) {
      return lastMaterial as THREE.Material;
    }
  }

  const directMaterial = value.material;
  if (directMaterial && typeof directMaterial === 'object' && (directMaterial as { isMaterial?: boolean }).isMaterial) {
    return directMaterial as THREE.Material;
  }

  return undefined;
}

function splitPath(path: string): { basePath: string; fileName: string } {
  const normalized = path.replaceAll('\\', '/');
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex === -1) {
    return { basePath: '', fileName: normalized };
  }

  return {
    basePath: `${normalized.slice(0, separatorIndex + 1)}`,
    fileName: normalized.slice(separatorIndex + 1),
  };
}

async function createInterfaceValidator(query: ViewerQuery): Promise<unknown> {
  if (query.materialXLoaderVariant !== 'custom' || !query.interfaceValidatorPath) {
    return undefined;
  }

  const module = (await import(/* @vite-ignore */ query.interfaceValidatorPath)) as StrictInterfaceValidationModule;
  if (typeof module.createStrictInterfaceValidator !== 'function') {
    throw new Error(
      `MaterialX interface validator module did not export createStrictInterfaceValidator: ${query.interfaceValidatorPath}`,
    );
  }

  return module.createStrictInterfaceValidator();
}

function disposeMaterialTextures(material: THREE.Material): void {
  const candidate = material as unknown as Record<string, unknown>;
  for (const value of Object.values(candidate)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const texture = value as { isTexture?: boolean; dispose?: () => void };
    if (texture.isTexture && typeof texture.dispose === 'function') {
      texture.dispose();
    }
  }
}

function disposeObject3DResources(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.geometry?.dispose();
    const meshMaterial = mesh.material;
    if (Array.isArray(meshMaterial)) {
      for (const material of meshMaterial) {
        if (material?.isMaterial) {
          materials.add(material);
        }
      }
      return;
    }
    if (meshMaterial && typeof meshMaterial === 'object' && (meshMaterial as { isMaterial?: boolean }).isMaterial) {
      materials.add(meshMaterial as THREE.Material);
    }
  });

  for (const material of materials) {
    disposeMaterialTextures(material);
    material.dispose();
  }
}

function replicatePrimaryUvToSecondaryUv(model: THREE.Object3D): void {
  model.traverse((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }

    const primaryUv = mesh.geometry.getAttribute('uv');
    if (primaryUv && !mesh.geometry.getAttribute('uv1')) {
      mesh.geometry.setAttribute('uv1', primaryUv.clone());
    }
  });
}

function recenterAndNormalizeModel(model: THREE.Object3D): void {
  // First, bake the GLTF node hierarchy into the geometry to match MaterialXView's "Object Space"
  model.updateMatrixWorld(true);
  model.traverse((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.applyMatrix4(mesh.matrixWorld);
    }
  });

  // Reset the hierarchy matrices since they are now baked
  model.traverse((node: THREE.Object3D) => {
    node.position.set(0, 0, 0);
    node.rotation.set(0, 0, 0);
    node.scale.set(1, 1, 1);
    node.quaternion.identity();
    node.updateMatrix();
  });
  model.updateMatrixWorld(true);

  // Now, apply the centering and scaling as a root transform
  // This matches MaterialXView's "World Space" matrix
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const sphereRadius = size.length() * 0.5;
  if (sphereRadius <= 0) {
    return;
  }

  const scale = IDEAL_MESH_SPHERE_RADIUS / sphereRadius;
  const center = box.getCenter(new THREE.Vector3());
  model.scale.setScalar(scale);
  model.position.copy(center).multiplyScalar(-scale);
  model.updateMatrixWorld(true);
}

async function buildScene(): Promise<void> {
  const query = parseQuery(window.location.search);
  const [backgroundR, backgroundG, backgroundB] = query.backgroundColor;

  const mount = document.getElementById('capture-root');
  if (!mount) {
    throw new Error('Capture root element not found.');
  }

  let sceneForCleanup: THREE.Scene | undefined;
  let rendererForCleanup: THREE.WebGPURenderer | undefined;
  let environmentTextureForCleanup: THREE.Texture | undefined;
  let modelForCleanup: THREE.Object3D | undefined;
  let materialXLoaderForCleanup: MaterialXLoaderLike | undefined;
  globalThis.__MTLX_DISPOSE_SCENE__ = () => {
    materialXLoaderForCleanup?.dispose?.();
    if (modelForCleanup) {
      disposeObject3DResources(modelForCleanup);
    }
    environmentTextureForCleanup?.dispose();
    if (sceneForCleanup) {
      sceneForCleanup.clear();
    }
    void rendererForCleanup?.dispose();
    const domElement = rendererForCleanup?.domElement;
    domElement?.parentElement?.removeChild(domElement);
    globalThis.__MTLX_FORCE_RENDER__ = undefined;
  };

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    forceWebGL: false,
  });
  rendererForCleanup = renderer;
  renderer.setPixelRatio(1);
  renderer.setSize(REFERENCE_IMAGE_WIDTH, REFERENCE_IMAGE_HEIGHT, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(new THREE.Color(backgroundR ?? 0, backgroundG ?? 0, backgroundB ?? 0), 1);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  sceneForCleanup = scene;
  const camera = new THREE.PerspectiveCamera(45, REFERENCE_IMAGE_WIDTH / REFERENCE_IMAGE_HEIGHT, 0.05, 1000);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  const renderFrame = (): void => {
    renderer.render(scene, camera);
  };
  globalThis.__MTLX_FORCE_RENDER__ = renderFrame;

  const hdrLoader = new HDRLoader();
  const environmentTexture = await hdrLoader.loadAsync(query.environmentHdrPath);
  environmentTextureForCleanup = environmentTexture;
  environmentTexture.mapping = THREE.EquirectangularReflectionMapping;
  const environmentRotationRadians = THREE.MathUtils.degToRad(query.environmentRotationDegrees);
  scene.environment = environmentTexture;
  scene.environmentRotation.set(0, environmentRotationRadians, 0);
  scene.background = environmentTexture;
  const sceneWithBackgroundRotation = scene as THREE.Scene & { backgroundRotation?: THREE.Euler };
  sceneWithBackgroundRotation.backgroundRotation?.set(0, environmentRotationRadians, 0);

  const gltfLoader = new GLTFLoader();
  const gltf = await gltfLoader.loadAsync(query.modelPath);
  modelForCleanup = gltf.scene;
  replicatePrimaryUvToSecondaryUv(gltf.scene);
  recenterAndNormalizeModel(gltf.scene);
  scene.add(gltf.scene);

  const materialXPath = splitPath(query.mtlxPath);
  const materialXLoader = new MaterialXLoader() as unknown as MaterialXLoaderLike;
  materialXLoader.setPath(materialXPath.basePath);
  materialXLoaderForCleanup = materialXLoader;
  const interfaceValidator = await createInterfaceValidator(query);
  const materialXResult =
    query.materialXLoaderVariant === 'custom'
      ? await materialXLoader.loadAsync(materialXPath.fileName, {
          interfaceValidator,
          throwOnErrors: false,
          uvSpace: 'top-left',
        })
      : await materialXLoader.loadAsync(materialXPath.fileName);
  globalThis.__MTLX_MATERIALX_LOG__ = readMaterialXLog(materialXResult);

  const resolvedMaterial = firstMaterial(materialXResult);
  if (!resolvedMaterial) {
    throw new Error('MaterialXLoader did not produce a surface material.');
  }

  const calibrationMesh = gltf.scene.getObjectByName('Calibration_Mesh') as THREE.Mesh | undefined;
  const previewMesh = gltf.scene.getObjectByName('Preview_Mesh') as THREE.Mesh | undefined;
  if (calibrationMesh?.isMesh && previewMesh?.isMesh) {
    calibrationMesh.material = resolvedMaterial;
    previewMesh.material = resolvedMaterial;
    if ((resolvedMaterial as THREE.Material).transparent) {
      calibrationMesh.renderOrder = 1;
      previewMesh.renderOrder = 2;
    }
  } else {
    gltf.scene.traverse((node: THREE.Object3D) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = resolvedMaterial;
      }
    });
  }

  if (typeof renderer.compileAsync === 'function') {
    await renderer.compileAsync(gltf.scene, camera, scene);
  }
  renderFrame();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  renderFrame();
}

async function initialize(): Promise<void> {
  globalThis.__MTLX_CAPTURE_DONE__ = false;
  delete globalThis.__MTLX_CAPTURE_ERROR__;
  globalThis.__MTLX_MATERIALX_LOG__ = [];
  globalThis.__MTLX_FORCE_RENDER__ = undefined;
  globalThis.__MTLX_DISPOSE_SCENE__ = undefined;

  try {
    await buildScene();
  } catch (error) {
    globalThis.__MTLX_CAPTURE_ERROR__ = error instanceof Error ? error.message : String(error);
  } finally {
    globalThis.__MTLX_CAPTURE_DONE__ = true;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found.');
}

const root = createRoot(rootElement);
flushSync(() => {
  root.render(
    <div
      id="capture-root"
      style={{
        width: '100%',
        height: '100%',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    />,
  );
});

void initialize();
