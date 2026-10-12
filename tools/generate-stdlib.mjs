// Regenerates shared/src/stdlib.generated.ts from a Jyro checkout.
//
// Usage: npm run generate:stdlib [-- <jyro checkout>]
// The checkout defaults to ../jyro, beside this repository. It needs .NET 8 or
// later, and Jyro 15c73c1 or later, which documents the standard library in
// Jyro.Stdlib.xml.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jyroDir = resolve(process.argv[2] ?? resolve(root, '..', 'jyro'));
const output = resolve(root, 'shared', 'src', 'stdlib.generated.ts');

if (!existsSync(resolve(jyroDir, 'src', 'Jyro.Stdlib', 'Jyro.Stdlib.fsproj'))) {
    console.error(`No Jyro checkout at ${jyroDir}`);
    process.exit(1);
}

// Name the source in the generated file: the commit, and whether it had changes
let source = jyroDir;
try {
    const git = (...args) => execFileSync('git', ['-C', jyroDir, ...args], { encoding: 'utf8' }).trim();
    const commit = git('rev-parse', '--short', 'HEAD');
    const dirty = git('status', '--porcelain', '--', 'src') !== '';
    source = `Jyro ${commit}${dirty ? ' (with local changes)' : ''}`;
} catch {
    // Not a git checkout: the path will do
}

execFileSync('dotnet', [
    'run',
    '--project', resolve(root, 'tools', 'stdlib-gen', 'StdlibGen.csproj'),
    '-c', 'Release',
    `-p:JyroDir=${jyroDir}`,
    '--',
    output,
    source
], { stdio: 'inherit' });

// The TextMate grammar names the same functions, for their highlighting
const generated = readFileSync(output, 'utf8');
const functions = JSON.parse(generated.substring(generated.indexOf('= [') + 2, generated.lastIndexOf(';')));
const grammarPath = resolve(root, 'syntaxes', 'jyro.tmLanguage.json');
const grammar = readFileSync(grammarPath, 'utf8');
const block = grammar.indexOf('"stdlib-functions"');
const matchStart = grammar.indexOf('"match": "', block) + '"match": "'.length;
const matchEnd = grammar.indexOf('",', matchStart);
if (block < 0 || matchStart < block || matchEnd < 0) {
    console.error(`No stdlib-functions pattern in ${grammarPath}`);
    process.exit(1);
}
const pattern = `\\\\b(${functions.map(f => f.name).join('|')})(?=\\\\s*\\\\()`;
writeFileSync(grammarPath, grammar.substring(0, matchStart) + pattern + grammar.substring(matchEnd));
console.log(`Wrote ${functions.length} function names to ${grammarPath}`);
