import { parseCliArgs, USAGE, type CliArgs, type CommandName } from './args';
import { runBuild } from './commands/build';
import { runDev } from './commands/dev';
import { runPack } from './commands/pack';
import { runTest } from './commands/test';
import { runValidate } from './commands/validate';
import { consoleOutput, type Output } from './output';

type Command = (args: CliArgs, out: Output) => Promise<number>;

const COMMAND_HANDLERS: Record<CommandName, Command> = {
  build: runBuild,
  dev: runDev,
  validate: runValidate,
  test: runTest,
  pack: runPack,
};

const HELP_FLAGS = new Set(['-h', '--help', 'help']);

/**
 * pb-plugin entry point.
 *
 * @param argv - Arguments after `pb-plugin`.
 * @param out - Where to print.
 * @returns Process exit code.
 */
export async function main(argv: string[], out: Output = consoleOutput()): Promise<number> {
  if (argv.length === 0 || HELP_FLAGS.has(argv[0]!)) {
    out.info(USAGE);
    return argv.length === 0 ? 1 : 0;
  }
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    out.error(`${parsed.error}\n\n${USAGE}`);
    return 1;
  }
  return COMMAND_HANDLERS[parsed.args.command](parsed.args, out);
}
