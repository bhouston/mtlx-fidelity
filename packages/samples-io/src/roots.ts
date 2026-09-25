import path from 'node:path';
import { getMaterialsRoot, getSamplesRootFromSubmodules, type SampleRoots } from '@material-fidelity/samples';

const cachedRootsByInvocationCwd = new Map<string, SampleRoots>();

export function inferRepoRoot(invocationCwd: string): string {
  if (path.basename(invocationCwd) === 'viewer' && path.basename(path.dirname(invocationCwd)) === 'packages') {
    return path.dirname(path.dirname(invocationCwd));
  }

  return invocationCwd;
}

export function resolveSampleRoots(invocationCwd: string = process.env.INIT_CWD ?? process.cwd()): SampleRoots {
  if (process.env.NODE_ENV !== 'test') {
    const cachedRoots = cachedRootsByInvocationCwd.get(invocationCwd);
    if (cachedRoots) {
      return cachedRoots;
    }
  }

  const repoRoot = inferRepoRoot(invocationCwd);
  const submodulesRoot = path.join(repoRoot, 'submodules');
  const samplesRoot = getSamplesRootFromSubmodules(submodulesRoot);
  const materialsRoot = getMaterialsRoot(samplesRoot);

  const resolvedRoots = {
    repoRoot,
    submodulesRoot,
    samplesRoot,
    materialsRoot,
  };

  if (process.env.NODE_ENV !== 'test') {
    cachedRootsByInvocationCwd.set(invocationCwd, resolvedRoots);
  }

  return resolvedRoots;
}
