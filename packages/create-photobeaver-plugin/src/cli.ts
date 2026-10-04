import path from 'node:path';
import { parseCreateArgs, USAGE } from './args';
import { scaffoldPlugin, type ScaffoldResult } from './scaffold';

function nextSteps(result: ScaffoldResult): string {
  const relative = path.relative(process.cwd(), result.dir) || '.';
  return [
    `Created ${result.id} in ${result.dir}`,
    '',
    'Next steps:',
    `  cd ${relative}`,
    '  npm install',
    '  npm test',
    '  npm run dev',
  ].join('\n');
}

/**
 * create-photobeaver-plugin entry point.
 *
 * @param argv - Arguments after the executable.
 * @returns Process exit code.
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseCreateArgs(argv);
  if (!parsed.ok) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    return 1;
  }
  try {
    console.log(nextSteps(await scaffoldPlugin(parsed.options)));
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}
