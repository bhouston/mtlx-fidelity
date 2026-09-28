import { BUILT_IN_RENDERER_DESCRIPTORS, type RendererDescriptor } from '@mtlx-fidelity/samples';

export function getRendererMetadata(rendererName: string): RendererDescriptor | undefined {
  return BUILT_IN_RENDERER_DESCRIPTORS.find((entry) => entry.name === rendererName);
}
