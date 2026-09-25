import type { RenderLogEntry } from '@material-fidelity/samples';

export interface GenerateImageOptions {
  mtlxPath: string;
  outputPngPath: string;
}

export interface GenerateImageResult {
  logs: RenderLogEntry[];
}

export interface RendererStartOptions {
  modelPath: string;
  environmentHdrPath: string;
  backgroundColor: string;
}

export interface RendererPrerequisiteCheckResult {
  success: boolean;
  message?: string;
}

export type RendererCategory = 'pathtracer' | 'raytracer' | 'rasterizer';

export interface FidelityRenderer {
  name: string;
  version: string;
  category: RendererCategory;
  emptyReferenceImagePath: string;
  checkPrerequisites: () => Promise<RendererPrerequisiteCheckResult> | RendererPrerequisiteCheckResult;
  start: (options: RendererStartOptions) => Promise<void>;
  shutdown: () => Promise<void>;
  generateImage: (options: GenerateImageOptions) => Promise<GenerateImageResult>;
}

export interface RendererContext {
  submodulesRoot: string;
}

export interface CreateReferencesOptions {
  submodulesRoot: string;
  renderers: FidelityRenderer[];
  rendererNames?: string[];
  materialSelectors?: string[];
  concurrency: number;
  skipExisting?: boolean;
  filter?: string;
  shouldStop?: () => boolean;
  onPlan?: (event: CreateReferencesPlanEvent) => void | Promise<void>;
  onProgress?: (event: CreateReferencesProgressEvent) => void | Promise<void>;
}

export interface RenderFailure {
  rendererName: string;
  materialPath: string;
  outputPngPath: string;
  error: Error;
  logs?: RenderLogEntry[];
}

export interface CreateReferencesResult {
  rendererNames: string[];
  total: number;
  attempted: number;
  rendered: number;
  failures: RenderFailure[];
  stopped: boolean;
}

export interface CreateReferencesPlanEvent {
  materialPaths: string[];
}

export interface CreateReferencesProgressEvent {
  phase: 'start' | 'finish';
  rendererName: string;
  materialPath: string;
  outputPngPath: string;
  total: number;
  started: number;
  completed: number;
  success?: boolean;
  durationMs?: number;
  error?: Error;
  logs?: RenderLogEntry[];
}
