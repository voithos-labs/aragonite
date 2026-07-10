// Assemble the public docs pack — the exact doc set a third-party plugin author
// receives. Inclusion criterion: ships publicly at 1.0 as authoring documentation.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

// README stays out (user call): it serves repo navigation, and npm auto-includes
// it in the tarball anyway — the guides are the pack's entry points.
const MANIFEST = [
	'docs/editor/consumer-guide.md',
	'docs/editor/plugin-guide.md',
	'docs/editor/directives.md',
	'docs/editor/gfm-reference.md'
];

const target = process.argv[2];
if (!target) {
	console.error('usage: node scripts/build-docs-pack.mjs <target-dir>');
	process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const doc of MANIFEST) copyFileSync(doc, join(target, basename(doc)));

// The pack is flat, so an .md link resolves only if it names a packed file's
// basename — any other .md target is a dead pointer the wall-token grep cannot
// see (its path may contain none of the wall tokens). Deliberately regex-level:
// a fenced-code example link counts as a violation, which keeps the gate
// conservative and dependency-free.
const packNames = new Set(MANIFEST.map((doc) => basename(doc)));
const deadPointers = [];
for (const name of packNames) {
	const text = readFileSync(join(target, name), 'utf8');
	for (const [, linkTarget] of text.matchAll(/\]\(([^)]+)\)/g)) {
		const path = linkTarget.split(/[#\s]/)[0].replace(/^\.\//, '');
		if (!path.endsWith('.md') || path.includes('://')) continue;
		if (!packNames.has(path)) deadPointers.push(`${name}: ](${linkTarget})`);
	}
}
if (deadPointers.length > 0) {
	console.error('docs-pack: dead .md pointers (every target must be a packed basename):');
	for (const hit of deadPointers) console.error(`  ${hit}`);
	process.exit(1);
}
console.log(`docs-pack: ${MANIFEST.length} docs → ${target}`);
