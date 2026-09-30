import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validate } from '@clidoc/core';
import { afterEach, expect, it } from 'vitest';
import { validateCommands } from 'yargs-file-commands';

const commandsDir = fileURLToPath(new URL('../dist/commands', import.meta.url));
const cliBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const execFileAsync = promisify(execFile);
let outputDir: string | undefined;

afterEach(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
  outputDir = undefined;
});

it('validates all command definitions outside CLI startup', async () => {
  await expect(validateCommands({ commandDirs: [commandsDir] })).resolves.toBeUndefined();
});

it('writes a valid OpenCLI document covering the commands', async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'mtlx-fidelity-docgen-'));
  const output = join(outputDir, 'cli.json');

  await execFileAsync(process.execPath, [cliBin, 'docgen', '--output', output]);

  const document = JSON.parse(await readFile(output, 'utf8'));
  expect(validate(document)).toEqual({ valid: true, errors: [] });
  expect(Object.keys(document.commands)).toEqual(expect.arrayContaining(['cli metrics', 'cli render', 'cli docgen']));
});
