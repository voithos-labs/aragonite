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

// The pack is flat and ships only .md, so a relative pointer resolves iff it names
// another packed .md basename. Anything else is dead once the doc leaves the repo:
// an unpacked .md, a path with directories, or a relative image/asset the pack
// never copies. Reference an unpacked doc by naming its path as inline code
// instead. Every target is normalized (trimmed, angle brackets and titles and
// fragments stripped) before the test, so a padded, bracketed, or anchored form
// can't smuggle a dead pointer past the check. Deliberately regex-level: a link
// inside a fenced example counts as a violation, which keeps the gate conservative
// and dependency-free.
const INLINE_TARGET = /\]\(([^)]+)\)/g; // `[text](t)` and `![alt](t)` (the latter contains `](t)`)
const REFERENCE_TARGET = /^[ \t]*\[[^\]]+\]:[ \t]*(\S+)/gm; // `[label]: t` link definitions

function normalizeTarget(raw) {
	let target = raw.trim();
	if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
	target = target.replace(/\s+["'].*$/s, ''); // drop a link title: `t "Title"`
	target = target.split('#')[0]; // drop the fragment
	return target.replace(/^\.\//, '');
}

function isExternal(target) {
	return (
		target.includes('://') ||
		target.startsWith('//') ||
		target.startsWith('mailto:') ||
		target.startsWith('data:')
	);
}

function isPackedMd(target) {
	return target.endsWith('.md') && target === basename(target) && packNames.includes(target);
}

const deadPointers = [];
for (const name of packNames) {
	const text = readFileSync(join(SOURCE_DIR, name), 'utf8');
	const rawTargets = [
		...[...text.matchAll(INLINE_TARGET)].map((m) => m[1]),
		...[...text.matchAll(REFERENCE_TARGET)].map((m) => m[1])
	];
	for (const raw of rawTargets) {
		const target = normalizeTarget(raw);
		if (target === '' || isExternal(target)) continue; // pure anchor or off-pack URL
		if (isPackedMd(target)) continue;
		deadPointers.push(`${name}: ${raw.trim()}`);
	}
}
if (deadPointers.length > 0) {
	console.error('docs-pack: dead pointers (every target must be a packed .md basename):');
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
