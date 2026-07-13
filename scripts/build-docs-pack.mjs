// The public docs pack — the exact doc set a third-party plugin author receives.
//
//   node scripts/build-docs-pack.mjs             verify the pack is link-closed
//   node scripts/build-docs-pack.mjs <dir>       verify, then write it to <dir>
//
// The set is docs/guide/ itself, not a manifest: a doc is authoring documentation
// or it isn't, and the folder is where that call is already recorded. A manifest
// would be a second place to forget.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

const SOURCE_DIR = 'docs/guide';

const packNames = readdirSync(SOURCE_DIR)
	.filter((name) => name.endsWith('.md'))
	.sort();
if (packNames.length === 0) {
	console.error(`docs-pack: no .md files in ${SOURCE_DIR}`);
	process.exit(1);
}

// The pack is flat, so an .md link resolves only if it names another packed file.
// Any other .md target is a dead pointer once the doc leaves the repo — a reader
// with the pack alone cannot follow it. Reference an unpacked doc by naming its
// path as inline code instead. Deliberately regex-level: a link inside a fenced
// example counts as a violation, which keeps the gate conservative and
// dependency-free.
const deadPointers = [];
for (const name of packNames) {
	const text = readFileSync(join(SOURCE_DIR, name), 'utf8');
	for (const [, linkTarget] of text.matchAll(/\]\(([^)]+)\)/g)) {
		const target = linkTarget.split(/[#\s]/)[0].replace(/^\.\//, '');
		if (!target.endsWith('.md') || target.includes('://')) continue;
		if (!packNames.includes(basename(target)) || target !== basename(target)) {
			deadPointers.push(`${name}: ](${linkTarget})`);
		}
	}
}
if (deadPointers.length > 0) {
	console.error('docs-pack: dead .md pointers (every target must be a packed basename):');
	for (const hit of deadPointers) console.error(`  ${hit}`);
	process.exit(1);
}

const target = process.argv[2];
if (!target) {
	console.log(`docs-pack: ${packNames.length} docs link-closed (${packNames.join(', ')})`);
	process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of packNames) copyFileSync(join(SOURCE_DIR, name), join(target, name));
console.log(`docs-pack: ${packNames.length} docs → ${target}`);
