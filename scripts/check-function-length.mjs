import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('apps/desktop/package.json'));
const ts = require('typescript');

const MAX_LINES = 20;
const ROOTS = ['apps', 'packages', 'plugins'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'release', 'tests', 'coverage']);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(full);
    return /\.(ts|tsx|mts)$/.test(name) && !name.endsWith('.d.ts') ? [full] : [];
  });
}

function nameOf(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (
    parent &&
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent))
  )
    return ts.isIdentifier(parent.name) ? parent.name.text : null;
  return null;
}

function isMeasured(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

function offenders(file) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    const name = isMeasured(node)
      ? (nameOf(node) ?? (ts.isConstructorDeclaration(node) ? 'constructor' : null))
      : null;
    if (name && node.body) {
      const start = source.getLineAndCharacterOfPosition(node.body.getStart(source)).line;
      const end = source.getLineAndCharacterOfPosition(node.body.getEnd()).line;
      const lines = ts.isBlock(node.body) ? end - start - 1 : end - start + 1;
      if (lines > MAX_LINES)
        found.push(`${lines}\t${path.relative(process.cwd(), file)}:${start + 1}\t${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const results = ROOTS.flatMap((root) => sourceFiles(root)).flatMap(offenders);
results.sort((a, b) => Number(b.split('\t')[0]) - Number(a.split('\t')[0]));
for (const line of results) console.log(line);
if (results.length > 0) {
  console.error(`${results.length} function(s) over ${MAX_LINES} lines`);
  process.exit(1);
}
