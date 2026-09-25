import { beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from './render.js';
import type { createReferences } from '@material-fidelity/core';

const { availableParallelismMock, createReferencesMock } = vi.hoisted(() => ({
  availableParallelismMock: vi.fn<() => number>(() => 8),
  createReferencesMock: vi.fn<typeof createReferences>(),
}));

vi.mock('node:os', async (importActual) => {
  const actual = await importActual<typeof import('node:os')>();
  return {
    ...actual,
    availableParallelism: availableParallelismMock,
  };
});

vi.mock('@material-fidelity/core', () => ({
  createReferences: createReferencesMock,
}));

vi.mock('@material-fidelity/renderer-blender', () => ({
  createRenderer: () => ({
    name: 'blender-new',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createNodesRenderer: () => ({
    name: 'blender-nodes',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createEeveeNodesRenderer: () => ({
    name: 'blender-eevee-nodes',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
}));

vi.mock('@material-fidelity/renderer-materialxview', () => ({
  createRenderer: () => ({
    name: 'materialx-glsl',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createGlslRenderer: () => ({
    name: 'materialx-glsl',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createMetalRenderer: () => ({
    name: 'materialx-metal',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createOslRenderer: () => ({
    name: 'materialx-osl',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
}));

vi.mock('@material-fidelity/renderer-threejs', () => ({
  createRenderer: () => ({
    name: 'threejs-new',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
  createCurrentRenderer: () => ({
    name: 'threejs-current',
    version: 'test',
    checkPrerequisites: async () => ({ success: true }),
    start: async () => undefined,
    shutdown: async () => undefined,
    generateImage: async () => undefined,
  }),
}));

describe('render command', () => {
  beforeEach(() => {
    availableParallelismMock.mockReset();
    availableParallelismMock.mockReturnValue(8);
    createReferencesMock.mockReset();
    createReferencesMock.mockResolvedValue({
      rendererNames: ['materialx-glsl'],
      total: 6,
      attempted: 6,
      rendered: 6,
      failures: [],
      stopped: false,
    });
  });

  it('is invoked as render', () => {
    expect(command.command).toBe('render');
  });

  it('invokes core createReferences with parsed options', async () => {
    await command.handler({
      renderers: ['materialx-glsl'],
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: 2,
      _: [],
      $0: 'cli',
    });

    expect(createReferencesMock).toHaveBeenCalledTimes(1);
    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      rendererNames: ['materialx-glsl'],
      submodulesRoot: expect.any(String),
      concurrency: 2,
      skipExisting: false,
    });
    expect(firstCall?.[0].submodulesRoot.endsWith('/submodules')).toBe(true);
    expect(firstCall?.[0].renderers).toHaveLength(8);
  });

  it('defaults concurrency to the recommended available parallelism', async () => {
    availableParallelismMock.mockReturnValue(8);

    const argv = {
      renderers: undefined,
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: undefined,
      _: [],
      $0: 'cli',
    } as unknown as Parameters<typeof command.handler>[0];

    await command.handler(argv);

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      concurrency: 8,
    });
  });

  it('keeps the default concurrency at least 1', async () => {
    availableParallelismMock.mockReturnValue(1);

    const argv = {
      renderers: undefined,
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: undefined,
      _: [],
      $0: 'cli',
    } as unknown as Parameters<typeof command.handler>[0];

    await command.handler(argv);

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      concurrency: 1,
    });
  });

  it('passes materials selectors through to core createReferences', async () => {
    await command.handler({
      renderers: ['materialx-glsl,threejs-new'],
      materials: ['standard_surface', '/gltf_pbr/i'],
      'skip-existing': false,
      skipExisting: false,
      filter: 'stdlib',
      concurrency: 1,
      _: [],
      $0: 'cli',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      rendererNames: ['materialx-glsl', 'threejs-new'],
      materialSelectors: ['standard_surface', '/gltf_pbr/i', 'stdlib'],
    });
  });

  it('expands renderer selectors using partial matches', async () => {
    await command.handler({
      renderers: ['threejs', 'blender'],
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: 1,
      _: [],
      $0: 'cli',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      rendererNames: ['threejs-new', 'threejs-current', 'blender-new', 'blender-nodes', 'blender-eevee-nodes'],
    });
  });

  it('defaults to all renderers when --renderers is omitted', async () => {
    await command.handler({
      renderers: undefined,
      materials: undefined,
      'skip-existing': false,
      skipExisting: false,
      filter: undefined,
      concurrency: 1,
      _: [],
      $0: 'cli',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      rendererNames: [],
      materialSelectors: [],
    });
  });

  it('passes skipExisting through to core createReferences', async () => {
    await command.handler({
      renderers: undefined,
      materials: undefined,
      'skip-existing': true,
      skipExisting: true,
      filter: undefined,
      concurrency: 1,
      _: [],
      $0: 'cli',
    });

    const [firstCall] = createReferencesMock.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({
      skipExisting: true,
    });
  });
});
