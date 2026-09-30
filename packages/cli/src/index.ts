import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { infoFromPackageJson } from '@clidoc/core';
import { createDocgenCommand, fromYargsAsync } from '@clidoc/yargs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';

export async function runCli(argv = hideBin(process.argv)): Promise<void> {
  const commandsDir = fileURLToPath(new URL('./commands', import.meta.url));
  const commandModules = await fileCommands({ commandDirs: [commandsDir] });
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const docgen = createDocgenCommand(() => fromYargsAsync([...commandModules, docgen], infoFromPackageJson(pkg)));

  await yargs(argv)
    .scriptName('cli')
    .usage('$0 <command>')
    .command(commandModules)
    .command(docgen)
    .strictCommands()
    .demandCommand(1)
    .help()
    .parseAsync();
}
