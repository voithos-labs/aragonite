// The docs name seams by path and symbol, and the tree names docs back by section, so a moved
// seam or a renamed heading has to move its citers. In `docs/design` and `docs/contributing` every
// backticked `src/`, `docs/` or `scripts/` span must resolve on disk, and a symbol after `::` must
// appear word-bounded in that file (fenced blocks exempt). Repo-wide, a `<doc>.md § Name` pointer
// must slug-match a heading of that doc. Existence, not correctness: a stale claim about a live
// file passes.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC_DIRS = ['docs/design', 'docs/contributing'];
const REFERENCE_ROOT = /^(?:src|docs|scripts)\//;
const CODE_SPAN = /(`+)((?:(?!\1).)*?)\1/g;

/** Roots a `§` pointer is cited from; a gitignored doc beside them ships nowhere and is dropped. */
const POINTER_ROOTS = ['src', 'docs', 'scripts', 'examples', 'README.md', 'CONTRIBUTING.md'];
const POINTER_EXTENSIONS = ['.ts', '.svelte', '.md', '.mjs', '.css'];
const SKIPPED_DIRS = new Set(['node_modules', 'build', 'dist', '.svelte-kit', 'superpowers']);

/**
 * @typedef {object} Reference A `path` or `path :: Symbol` span a doc claims.
 * @property {string} file
 * @property {string} path
 * @property {string} [symbol]
 */

/**
 * @typedef {object} Pointer A `<doc>.md § Name` citation.
 * @property {string} file
 * @property {string} doc
 * @property {string} fragment The section name, slugified.
 * @property {string} raw
 */

// ── Corpus ──────────────────────────────────────────────────────────────

/**
 * @param {string} dir
 * @returns {string[]}
 */
function markdownIn(dir) {
	if (!existsSync(dir)) {
		console.error(`codebase-map: ${dir} is missing`);
		process.exit(1);
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md'))
		.sort()
		.map((name) => `${dir}/${name}`);
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(dir, out) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIPPED_DIRS.has(entry.name)) continue;
		const full = `${dir}/${entry.name}`;
		if (entry.isDirectory()) walk(full, out);
		else if (POINTER_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
	}
	return out;
}

/**
 * A gitignored doc sits on disk beside the corpus but ships nowhere, so a pointer inside one is
 * not the repo's to gate. Outside a work tree nothing is ignored, which suits a synthetic corpus.
 * @param {string[]} roots
 * @returns {string[]}
 */
function ignoredFiles(roots) {
	try {
		return execSync(`git ls-files --others --ignored --exclude-standard -- ${roots.join(' ')}`, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.split('\n')
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Every citing file under `roots`, gitignored ones dropped as the docs-link gate drops them.
 * @param {string[]} roots
 * @returns {string[]}
 */
export function citingFiles(roots) {
	const ignored = new Set(ignoredFiles(roots));
	const found = roots.flatMap((root) => {
		if (!existsSync(root)) return [];
		return statSync(root).isDirectory() ? walk(root, []) : [root];
	});
	return found.filter((file) => !ignored.has(file)).sort();
}

// ── Reference spans ─────────────────────────────────────────────────────

/**
 * A fence holds diagrams and illustrative snippets that need not resolve; the docs make their
 * claims in inline code, so this blanks the opposite half of what the docs-link gate blanks.
 * @param {string} text
 * @returns {string}
 */
export function stripFencedBlocks(text) {
	/** @type {string | null} */
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
			return line;
		})
		.join('\n');
}

/**
 * The references a doc claims, plus the spans shaped like one but written wrong.
 * @param {string} file
 * @param {string} text
 * @returns {{ references: Reference[], malformed: string[] }}
 */
export function referencesIn(file, text) {
	/** @type {Reference[]} */
	const references = [];
	/** @type {string[]} */
	const malformed = [];
	const spans = [...text.matchAll(CODE_SPAN)].map((match) => ({
		content: match[2].trim(),
		start: match.index,
		end: match.index + match[0].length
	}));
	for (const [index, span] of spans.entries()) {
		// Both spellings, since a reader writes whichever renders better: two adjacent spans joined
		// by `::`, or one span holding the whole reference.
		const parts = span.content.split('::').map((part) => part.trim());
		if (!REFERENCE_ROOT.test(parts[0])) continue; // a backticked `Mod` or `focus` is prose
		if (parts.length > 2) {
			malformed.push(
				`${file}: \`${span.content}\` — a reference is \`path\` or \`path :: Symbol\``
			);
			continue;
		}
		const next = spans[index + 1];
		const joined = next !== undefined && /^\s*::\s*$/.test(text.slice(span.end, next.start));
		references.push({
			file,
			path: parts[0],
			symbol: parts[1] ?? (joined ? next.content : undefined)
		});
	}
	return { references, malformed };
}

/**
 * A `<name>` placeholder or a `*` glob names a family, so only its concrete prefix can be checked:
 * `src/lib/plugins/<name>` still has to have a `src/lib/plugins`.
 * @param {string} target
 * @returns {string}
 */
function concretePrefix(target) {
	const segments = target.split('/');
	const wildcard = segments.findIndex((segment) => /[<*]/.test(segment));
	return wildcard === -1 ? target : segments.slice(0, wildcard).join('/');
}

/**
 * @param {string} symbol
 * @returns {RegExp}
 */
function symbolPattern(symbol) {
	return new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

/**
 * @param {Reference[]} references
 * @returns {string[]}
 */
export function referenceFailures(references) {
	/** @type {string[]} */
	const failures = [];
	for (const { file, path: target, symbol } of references) {
		const checked = concretePrefix(target);
		if (!existsSync(checked)) {
			const detail = checked === target ? '' : ` (\`${checked}\`)`;
			failures.push(`${file}: ${target}${detail} — no such file or directory`);
			continue;
		}
		if (symbol === undefined || checked !== target) continue;
		if (statSync(target).isDirectory()) {
			failures.push(`${file}: ${target} :: ${symbol} — a symbol reference must name a file`);
			continue;
		}
		if (!symbolPattern(symbol).test(readFileSync(target, 'utf8'))) {
			failures.push(`${file}: ${target} :: ${symbol} — symbol not found in that file`);
		}
	}
	return failures;
}

// ── Section pointers ────────────────────────────────────────────────────

const POINTER = /([A-Za-z0-9_./-]+\.md)`?[ \t]*§[ \t]*([^\n]{0,90})/g;
const NUMBERING = /^\d+(?:\.\d+)*[.)]?\s+/;
const LEADING_NUMBER = /^\d+(?:-\d+)*/;

/**
 * @param {string} text
 * @returns {string}
 */
function slug(text) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * Every spelling of one heading a citer plausibly writes: numbering dropped, a parenthetical
 * qualifier dropped, the half after a colon on its own, and a numbered heading's bare number.
 * @param {string} heading
 * @returns {Set<string>}
 */
export function headingKeys(heading) {
	/** @type {Set<string>} */
	const keys = new Set();
	const bare = heading.replace(NUMBERING, '');
	const tail = bare.includes(':') ? bare.slice(bare.indexOf(':') + 1) : bare;
	for (const spelling of [heading, bare, tail]) {
		for (const variant of [spelling, spelling.replace(/\([^)]*\)/g, '')]) {
			const key = slug(variant);
			if (key !== '') keys.add(key);
		}
	}
	const numbered = LEADING_NUMBER.exec(slug(heading));
	if (numbered) keys.add(numbered[0]);
	return keys;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function headingLines(text) {
	return text.split('\n').flatMap((line) => {
		const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
		return heading ? [heading[1]] : [];
	});
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
export function headingsOf(text) {
	/** @type {Set<string>} */
	const keys = new Set();
	for (const heading of headingLines(text)) for (const key of headingKeys(heading)) keys.add(key);
	return keys;
}

/**
 * The anchor each heading defines. The strict half of {@link headingsOf}, whose looser spellings
 * exist for a prose citer: a `#fragment` link means one slug, so an approximation of it resolves.
 * Fences go first — a `# comment` in a shell snippet defines no anchor a reader can reach.
 * @param {string} text
 * @returns {Set<string>}
 */
export function anchorsOf(text) {
	return new Set(headingLines(stripFencedBlocks(text)).map(slug));
}

/**
 * The section name a pointer claims, slugified, or null where the citation is a markdown link
 * (the anchor half is the pointer there). A quoted name ends at its quote and an unquoted one at
 * the bracket or parenthesis it was cited inside; a numbered pointer keeps the number and drops
 * the prose that runs on after it.
 * @param {string} raw
 * @returns {string | null}
 */
export function sectionFragment(raw) {
	let name = raw;
	if (name.startsWith('[')) return null;
	if (name.startsWith('"')) name = name.slice(1).split('"')[0];
	else name = name.split(')')[0].split(']')[0];
	const fragment = slug(name);
	if (fragment === '') return null;
	const numbered = LEADING_NUMBER.exec(fragment);
	return numbered ? numbered[0] : fragment;
}

/**
 * Prefix-matched in both directions, since a heading carries qualifiers a citer drops and a
 * citer's sentence runs on past the name; only a name sharing no head with any heading fails.
 * @param {Set<string>} keys
 * @param {string} fragment
 * @returns {boolean}
 */
export function resolvesAgainst(keys, fragment) {
	for (const key of keys) {
		if (key === fragment || key.startsWith(`${fragment}-`) || fragment.startsWith(`${key}-`)) {
			return true;
		}
	}
	return false;
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {Pointer[]}
 */
export function pointersIn(file, text) {
	/** @type {Pointer[]} */
	const pointers = [];
	for (const [, doc, raw] of text.matchAll(POINTER)) {
		const fragment = sectionFragment(raw);
		if (fragment !== null) pointers.push({ file, doc, fragment, raw: raw.trim() });
	}
	return pointers;
}

/**
 * @param {Pointer[]} pointers
 * @param {string[]} docs
 * @returns {string[]}
 */
function pointerFailures(pointers, docs) {
	/** @type {string[]} */
	const failures = [];
	for (const { file, doc, fragment, raw } of pointers) {
		const targets = docs.filter((known) => known === doc || known.endsWith(`/${doc}`));
		if (targets.length !== 1) {
			const detail = targets.length === 0 ? 'no such doc' : `names ${targets.length} docs`;
			failures.push(`${file}: ${doc} § ${raw} — ${detail}`);
			continue;
		}
		if (!resolvesAgainst(headingsOf(readFileSync(targets[0], 'utf8')), fragment)) {
			failures.push(`${file}: ${targets[0]} § ${raw} — no heading matches`);
		}
	}
	return failures;
}

// ── The run ─────────────────────────────────────────────────────────────

function main() {
	const docFiles = DOC_DIRS.flatMap(markdownIn);
	/** @type {Reference[]} */
	const references = [];
	/** @type {string[]} */
	const failures = [];
	for (const file of docFiles) {
		const parsed = referencesIn(file, stripFencedBlocks(readFileSync(file, 'utf8')));
		references.push(...parsed.references);
		failures.push(...parsed.malformed);
	}
	failures.push(...referenceFailures(references));

	const citing = citingFiles(POINTER_ROOTS);
	const pointers = citing.flatMap((file) => pointersIn(file, readFileSync(file, 'utf8')));
	const docs = citing.filter((file) => file.endsWith('.md'));
	failures.push(...pointerFailures(pointers, docs));

	if (failures.length > 0) {
		console.error(`codebase-map: unresolved references in ${DOC_DIRS.join(', ')}:`);
		for (const failure of failures) console.error(`  ${failure}`);
		process.exit(1);
	}

	const named = references.filter((reference) => reference.symbol !== undefined).length;
	console.log(
		`codebase-map: ${references.length} references resolve (${named} naming a symbol) across ${docFiles.length} files in ${DOC_DIRS.join(', ')}; ${pointers.length} § pointers resolve across ${citing.length} files`
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
