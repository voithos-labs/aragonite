// Two documentation gates, both run on every invocation. With a <dir> argument the pack
// is also written there (the directory is cleared first — see the refusal below).
// Gate 1: the public docs pack (docs/guide/) ships flat and .md-only, so every relative
// pointer must name a packed .md basename. Gate 2: the rest of the corpus (README,
// CONTRIBUTING, docs/) must have every relative link resolve to a real file or directory.
import { execSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SOURCE_DIR = 'docs/guide';

const packNames = readdirSync(SOURCE_DIR)
	.filter((name) => name.endsWith('.md'))
	.sort();
if (packNames.length === 0) {
	console.error(`docs-pack: no .md files in ${SOURCE_DIR}`);
	process.exit(1);
}

// A pointer resolves iff it names another packed .md basename; anything else is dead once the
// doc leaves the repo. Targets are normalized first, so a padded, bracketed, or anchored form
// can't smuggle one past. Regex-level on purpose: dependency-free and conservative.
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

// ── Gate 2: corpus link resolution ──────────────────────────────────────

const LINK_ROOTS = ['README.md', 'CONTRIBUTING.md', 'docs'];
const EXCLUDED_DIR = 'docs/superpowers'; // gitignored working area, not part of the shipped corpus

// A target legitimately unresolvable on disk that the checks below can't
// distinguish from a dead one. Each entry carries a reason; empty is healthy.
const LINK_ALLOWLIST = new Set();

// A gitignored doc (the owner's private roadmap and runbook) sits on disk beside the corpus
// but ships nowhere, so a dead pointer inside one is not the repo's to gate.
const IGNORED_FILES = new Set(
	execSync('git ls-files --others --ignored --exclude-standard -- ' + LINK_ROOTS.join(' '), {
		encoding: 'utf8'
	})
		.split('\n')
		.filter(Boolean)
);

function corpusMarkdownFiles(path, out) {
	if (path.split('\\').join('/') === EXCLUDED_DIR) return out;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) corpusMarkdownFiles(child, out);
		else if (entry.name.endsWith('.md') && !IGNORED_FILES.has(child.split('\\').join('/')))
			out.push(child);
	}
	return out;
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

const corpusFiles = [];
for (const root of LINK_ROOTS) {
	if (!existsSync(root)) continue;
	if (root.endsWith('.md')) corpusFiles.push(root);
	else corpusMarkdownFiles(root, corpusFiles);
}

const deadLinks = [];
for (const file of corpusFiles) {
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
	console.log(`docs-links: ${corpusFiles.length} corpus docs, every relative link resolves`);
	process.exit(0);
}

// ── Pack write ──────────────────────────────────────────────────────────

// The clear must not be able to take a tree with it on a mistyped argument, so two refusals
// bound what is clearable: the pack's own source, which is all-.md and would pass a shape test
// alone, and any directory holding an entry the pack never writes.
function refusalReason(dir) {
	if (dir === resolve(SOURCE_DIR)) return 'it is the pack source directory';
	if (!existsSync(dir)) return null;
	if (!statSync(dir).isDirectory()) return 'it is not a directory';
	const foreign = readdirSync(dir, { withFileTypes: true })
		.filter((entry) => !entry.isFile() || !entry.name.endsWith('.md'))
		.map((entry) => entry.name);
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
for (const name of readdirSync(packDir)) unlinkSync(join(packDir, name));
for (const name of packNames) copyFileSync(join(SOURCE_DIR, name), join(packDir, name));
console.log(`docs-pack: ${packNames.length} docs → ${target}`);
