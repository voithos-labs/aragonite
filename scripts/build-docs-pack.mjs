// Two documentation checks, run on every invocation; with a <dir> argument the pack is also
// written there, into a cleared directory. Gate 1: every relative link inside the public pack
// (docs/guide/) lands on a file the pack carries, and every `#fragment` outside code names a heading
// that doc still has. Gate 2: every relative link in README, CONTRIBUTING and docs/ resolves.
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	unlinkSync
} from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { anchorsOf } from './check-codebase-map.mjs';
import { corpusFiles } from './doc-corpus.mjs';

const SOURCE_DIR = 'docs/guide';

// The pack is the whole directory tree, docs and assets alike: package.json already ships
// `docs/guide` to npm wholesale, so one set keeps the two publishing paths in agreement.
function listPack(dir, prefix = '') {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix + entry.name;
		if (entry.isDirectory()) out.push(...listPack(join(dir, entry.name), rel + '/'));
		else if (entry.isFile()) out.push(rel);
	}
	return out.sort();
}
const packFiles = listPack(SOURCE_DIR);
const packNames = packFiles.filter((name) => name.endsWith('.md'));
if (packNames.length === 0) {
	console.error(`docs-pack: no .md files in ${SOURCE_DIR}`);
	process.exit(1);
}

// A pointer resolves iff it lands on a packed file, relative to the doc holding it; anything else
// is dead once the doc leaves the repo. Targets are normalized first, so a padded, bracketed, or
// anchored form can't smuggle one past. Regex-level on purpose: dependency-free and conservative.
const INLINE_TARGET = /\]\(([^)]+)\)/g; // `[text](t)` and `![alt](t)` (the latter contains `](t)`)
const REFERENCE_TARGET = /^[ \t]*\[[^\]]+\]:[ \t]*(\S+)/gm; // `[label]: t` link definitions

/** A target unwrapped and stripped of its link title, fragment still attached. */
function cleanTarget(raw) {
	let target = raw.trim();
	if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
	return target.replace(/\s+["'].*$/s, ''); // drop a link title: `t "Title"`
}

function normalizeTarget(raw) {
	return cleanTarget(raw).split('#')[0].replace(/^\.\//, '');
}

/** The `#fragment` a target carries, or `''` where it names a whole file. */
function targetFragment(raw) {
	const target = cleanTarget(raw);
	const at = target.indexOf('#');
	return at < 0 ? '' : target.slice(at + 1);
}

function isExternal(target) {
	return (
		target.includes('://') ||
		target.startsWith('//') ||
		target.startsWith('mailto:') ||
		target.startsWith('data:')
	);
}

// A markdown link written inside code never navigates, so blank fenced and inline code before
// scanning. Inline spans go per line, so one unbalanced backtick can't desync the rest.
const INLINE_CODE = /(`+)(?:(?!\1).)*?\1/g;
function stripCode(text) {
	let fence = null;
	return text
		.split('\n')
		.map((line) => {
			const fenceMark = line.match(/^\s*(```+|~~~+)/);
			if (fence) {
				if (fenceMark && line.trim().startsWith(fence)) fence = null;
				return '';
			}
			if (fenceMark) {
				fence = fenceMark[1][0].repeat(3);
				return '';
			}
			return line.replace(INLINE_CODE, '');
		})
		.join('\n');
}

const anchorIndex = new Map();
function anchorsIn(name) {
	if (!anchorIndex.has(name)) {
		anchorIndex.set(name, anchorsOf(readFileSync(join(SOURCE_DIR, name), 'utf8')));
	}
	return anchorIndex.get(name);
}

const deadPointers = [];
const deadAnchors = [];
for (const name of packNames) {
	const text = readFileSync(join(SOURCE_DIR, name), 'utf8');
	const targetsIn = (source) => [
		...[...source.matchAll(INLINE_TARGET)].map((m) => m[1]),
		...[...source.matchAll(REFERENCE_TARGET)].map((m) => m[1])
	];
	// A link shown inside code is an example: its file must still ship, but its anchor may be made up.
	const proseTargets = targetsIn(stripCode(text));
	for (const raw of targetsIn(text)) {
		const target = normalizeTarget(raw);
		if (isExternal(target)) continue; // off-pack URL
		// A `..` that climbs out of the pack can never land on a listed file; an empty target is
		// this doc's own anchor.
		const doc = target === '' ? name : posix.normalize(posix.join(posix.dirname(name), target));
		if (!packFiles.includes(doc)) {
			deadPointers.push(`${name}: ${raw.trim()}`);
			continue;
		}
		const shownInCode = !proseTargets.includes(raw);
		if (!shownInCode) proseTargets.splice(proseTargets.indexOf(raw), 1);
		const fragment = targetFragment(raw);
		if (fragment === '' || shownInCode || !doc.endsWith('.md')) continue;
		if (!anchorsIn(doc).has(fragment)) deadAnchors.push(`${name}: ${raw.trim()}`);
	}
}
if (deadPointers.length > 0) {
	console.error('docs-pack: dead pointers (every target must name a file the pack ships):');
	for (const hit of deadPointers) console.error(`  ${hit}`);
	process.exit(1);
}
if (deadAnchors.length > 0) {
	console.error('docs-pack: dangling anchors (every #fragment must name a heading its doc has):');
	for (const hit of deadAnchors) console.error(`  ${hit}`);
	process.exit(1);
}

// ── Gate 2: corpus link resolution ──────────────────────────────────────

const LINK_ROOTS = ['README.md', 'CONTRIBUTING.md', 'docs'];

// A target legitimately unresolvable on disk that the checks below can't
// distinguish from a dead one. Each entry carries a reason; empty is healthy.
const LINK_ALLOWLIST = new Set();

const corpus = corpusFiles(LINK_ROOTS, ['.md']);

const deadLinks = [];
for (const file of corpus) {
	const rel = file.split('\\').join('/');
	const text = stripCode(readFileSync(file, 'utf8'));
	const rawTargets = [...text.matchAll(INLINE_TARGET)].map((m) => m[1]);
	for (const m of text.matchAll(REFERENCE_TARGET)) {
		if (/^\s*\[\^/.test(m[0])) continue; // a footnote definition mimics a link definition
		rawTargets.push(m[1]);
	}
	for (const raw of rawTargets) {
		const link = normalizeTarget(raw);
		if (link === '' || isExternal(link)) continue;
		if (LINK_ALLOWLIST.has(`${rel} → ${link}`)) continue;
		if (!existsSync(join(dirname(file), link))) deadLinks.push(`${rel} → ${raw.trim()}`);
	}
}
if (deadLinks.length > 0) {
	console.error(
		'docs-links: dead links (every relative target must resolve to a real file or directory):'
	);
	for (const hit of deadLinks) console.error(`  ${hit}`);
	process.exit(1);
}

const target = process.argv[2];
// A dash-leading "target" is a mistyped flag; writing it mints a directory every git command
// then parses as a flag.
if (target?.startsWith('-')) {
	console.error(`docs-pack: refusing target "${target}" — looks like a flag, not a directory`);
	process.exit(1);
}
if (!target) {
	console.log(`docs-pack: ${packNames.length} docs link-closed (${packNames.join(', ')})`);
	console.log(`docs-links: ${corpus.length} corpus docs, every relative link resolves`);
	process.exit(0);
}

// ── Pack write ──────────────────────────────────────────────────────────

// The clear must not be able to take a tree with it on a mistyped argument, so two refusals
// bound what is clearable: the pack's own source, which would pass a shape test alone, and any
// directory holding an entry the pack never writes, checked down through the pack's subfolders.
const packDirs = new Set();
for (const name of packFiles) {
	for (let dir = posix.dirname(name); dir !== '.'; dir = posix.dirname(dir)) packDirs.add(dir);
}
function foreignEntries(dir, prefix = '') {
	const foreign = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix + entry.name;
		if (entry.isDirectory() && packDirs.has(rel)) {
			foreign.push(...foreignEntries(join(dir, entry.name), rel + '/'));
		} else if (!entry.isFile() || !packFiles.includes(rel)) foreign.push(rel);
	}
	return foreign;
}
function refusalReason(dir) {
	if (dir === resolve(SOURCE_DIR)) return 'it is the pack source directory';
	if (!existsSync(dir)) return null;
	if (!statSync(dir).isDirectory()) return 'it is not a directory';
	const foreign = foreignEntries(dir);
	return foreign.length === 0
		? null
		: `it holds entries the pack never writes: ${foreign.join(', ')}`;
}

const packDir = resolve(target);
const refusal = refusalReason(packDir);
if (refusal) {
	console.error(`docs-pack: refusing to write the pack to ${target} — ${refusal}`);
	process.exit(1);
}

mkdirSync(packDir, { recursive: true });
for (const entry of readdirSync(packDir, { withFileTypes: true })) {
	const path = join(packDir, entry.name);
	if (entry.isDirectory()) rmSync(path, { recursive: true });
	else unlinkSync(path);
}
for (const name of packFiles) {
	const dest = join(packDir, name);
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(join(SOURCE_DIR, name), dest);
}
console.log(`docs-pack: ${packFiles.length} files → ${target}`);
