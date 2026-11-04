// The docs name code by path and symbol, and the tree names docs back by section, so a moved
// file or a renamed heading has to move its citers. Every backticked path in the design,
// contributing and requirement docs (from a repo root, or written short to match a path's end)
// must name a file a checkout holds, and a symbol after `::` must appear in it (fences exempt).
// Repo-wide, a `<doc>.md § Name` pointer must slug-match a heading of that doc.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { citationProblem, corpusFiles, ignoredPaths, treePaths } from './doc-corpus.mjs';

const DOC_DIRS = ['docs/design', 'docs/contributing', 'src/lib/e2e/requirements'];
const REFERENCE_ROOT = /^(?:src|packages|docs|scripts)\//;
// A bare JSON name is as often a run's output (a report, a manifest) as a tracked file, so JSON
// is read only from a repo root.
const SHORT_PATH =
	/^(?:\.{1,2}\/)*(?:[\w@.<>*-]+\/)*[\w@<*-][\w@.<>*-]*\.(?:ts|tsx|svelte|vue|mjs|cjs|js|md|css|sh|py|ya?ml)$/;
const CODE_SPAN = /(`+)((?:(?!\1).)*?)\1/g;
const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies'
];

/** Roots a `§` pointer is cited from. */
const POINTER_ROOTS = [
	'src',
	'packages',
	'docs',
	'scripts',
	'examples',
	'README.md',
	'CONTRIBUTING.md'
];
const POINTER_EXTENSIONS = ['.ts', '.svelte', '.md', '.mjs', '.css'];

/**
 * @typedef {object} Reference A `path` or `path :: Symbol` span a doc claims.
 * @property {string} file
 * @property {string} path
 * @property {string} [symbol]
 */

/**
 * @typedef {object} Tree What references resolve against, read once per run.
 * @property {readonly string[]} ignored
 * @property {Map<string, string[]>} bySuffix Every tree path under each of its trailing paths.
 * @property {Set<string>} dirs
 * @property {Set<string>} packages The root manifest's dependency names.
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
 * Every file a `§` pointer may be cited from, gitignored ones dropped.
 * @param {string[]} roots
 * @returns {string[]}
 */
export function citingFiles(roots) {
	return corpusFiles(roots, POINTER_EXTENSIONS);
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
		if (!isPathClaim(parts[0])) {
			// A command names the files it runs: `npx vitest run src/lib/x.test.ts`.
			for (const token of span.content.split(/\s+/)) {
				const target = token.replace(/^['"]|['"]$/g, '');
				if (isPathClaim(target)) references.push({ file, path: target });
			}
			continue;
		}
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
 * @param {string} text
 * @returns {boolean}
 */
function isPathClaim(text) {
	return REFERENCE_ROOT.test(text) || SHORT_PATH.test(text);
}

/**
 * A `<name>` placeholder or a `*` or `{a,b}` glob names a family, so only its concrete prefix can
 * be checked: `packages/<name>/src` still has to have a `packages`.
 * @param {string} target
 * @returns {string}
 */
function concretePrefix(target) {
	const segments = target.split('/');
	const wildcard = segments.findIndex((segment) => /[<*{]/.test(segment));
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
 * The tree as references see it. A caller checking many files reads it once and passes it on.
 * @returns {Tree}
 */
export function readTree() {
	const { files, dirs } = treePaths();
	/** @type {Map<string, string[]>} */
	const bySuffix = new Map();
	for (const full of [...files, ...dirs]) {
		const segments = full.split('/');
		for (let start = 0; start < segments.length; start++) {
			const suffix = segments.slice(start).join('/');
			const paths = bySuffix.get(suffix);
			if (paths) paths.push(full);
			else bySuffix.set(suffix, [full]);
		}
	}
	const manifest = existsSync('package.json')
		? JSON.parse(readFileSync('package.json', 'utf8'))
		: {};
	const packages = new Set(
		DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}))
	);
	return { ignored: ignoredPaths(['.']), bySuffix, dirs, packages };
}

/**
 * @param {Reference[]} references
 * @param {Tree} [tree]
 * @returns {string[]}
 */
export function referenceFailures(references, tree = readTree()) {
	return references.flatMap((reference) => {
		const failure = REFERENCE_ROOT.test(reference.path)
			? rootedFailure(reference, tree)
			: shortFailure(reference, tree);
		return failure === null ? [] : [failure];
	});
}

/**
 * @param {Reference} reference
 * @param {Tree} tree
 * @returns {string | null}
 */
function rootedFailure({ file, path: target, symbol }, tree) {
	const checked = concretePrefix(target);
	const problem = citationProblem(checked, tree.ignored);
	if (problem) {
		const detail = checked === target ? '' : ` (\`${checked}\`)`;
		return `${file}: ${target}${detail} — ${problem}`;
	}
	if (symbol === undefined || checked !== target) return null;
	if (statSync(target).isDirectory()) {
		return `${file}: ${target} :: ${symbol} — a symbol reference must name a file`;
	}
	if (!symbolPattern(symbol).test(readFileSync(target, 'utf8'))) {
		return `${file}: ${target} :: ${symbol} — symbol not found in that file`;
	}
	return null;
}

/**
 * A short path names every tree path it ends, or with a leading `./` or `../` the one path it
 * reaches from its citer. A path into an installed package is the package's to keep.
 * @param {Reference} reference
 * @param {Tree} tree
 * @returns {string | null}
 */
function shortFailure({ file, path: target, symbol }, tree) {
	const checked = concretePrefix(target);
	if (checked === '' || isPackagePath(checked, tree.packages)) return null;
	const matches = shortMatches(file, checked, tree);
	if (matches.length === 0) {
		const detail = checked === target ? '' : ` (\`${checked}\`)`;
		return `${file}: ${target}${detail} — no file in the tree ends with that path`;
	}
	if (symbol === undefined || checked !== target) return null;
	const named = matches.filter((match) => !tree.dirs.has(match));
	if (named.length === 0) {
		return `${file}: ${target} :: ${symbol} — a symbol reference must name a file`;
	}
	const pattern = symbolPattern(symbol);
	if (!named.some((match) => pattern.test(readFileSync(match, 'utf8')))) {
		return `${file}: ${target} :: ${symbol} — symbol not found in any file that path names`;
	}
	return null;
}

/**
 * @param {string} file
 * @param {string} checked
 * @param {Tree} tree
 * @returns {string[]}
 */
function shortMatches(file, checked, tree) {
	if (!/^\.{1,2}\//.test(checked)) return tree.bySuffix.get(checked) ?? [];
	const reached = path.posix.join(path.posix.dirname(file), checked);
	return tree.bySuffix.get(reached)?.includes(reached) ? [reached] : [];
}

/**
 * @param {string} target
 * @param {Set<string>} packages
 * @returns {boolean}
 */
function isPackagePath(target, packages) {
	const segments = target.split('/');
	const name = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
	return segments.length > name.split('/').length && packages.has(name);
}

// ── Section pointers ────────────────────────────────────────────────────

const POINTER = /([A-Za-z0-9_./-]+\.md)`?[ \t]*§[ \t]*([^\n]{0,90})/g;
const NUMBERING = /^\d+(?:\.\d+)*[.)]?\s+/;
const LEADING_NUMBER = /^\d+(?:-\d+)*/;

/**
 * The lenient key a `§` pointer matches on: every non-alphanumeric run folds to one dash. An
 * anchor is stricter and slugs the way GitHub renders it ({@link githubAnchors}).
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
	return new Set(githubAnchors(headingLines(stripFencedBlocks(text))));
}

// GitHub keeps letters, marks, numbers, connector punctuation (`_`), spaces and `-`, and drops the
// rest, emoji included, before turning each space into its own `-`.
const GITHUB_DROPPED = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

/**
 * The anchor GitHub gives each heading of one document, in order: the rendered text (code-span
 * backticks, emphasis and link syntax gone) slugged, with `-1`, `-2` appended to a repeat.
 * @param {string[]} headings
 * @returns {string[]}
 */
export function githubAnchors(headings) {
	/** @type {Map<string, number>} */
	const seen = new Map();
	return headings.map((heading) => {
		const base = renderedHeadingText(heading)
			.toLowerCase()
			.replace(GITHUB_DROPPED, '')
			.replace(/ /g, '-');
		let anchor = base;
		while (seen.has(anchor)) {
			const count = (seen.get(base) ?? 0) + 1;
			seen.set(base, count);
			anchor = `${base}-${count}`;
		}
		seen.set(anchor, 0);
		return anchor;
	});
}

/**
 * A heading's text as a reader sees it: a link or image keeps its text, an HTML tag goes, and an
 * emphasis `_` goes while a snake_case one, or any inside a code span, stays.
 * @param {string} heading
 * @returns {string}
 */
function renderedHeadingText(heading) {
	return heading
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.split(/(`+[^`]*`+)/)
		.map((part, index) =>
			index % 2 === 1
				? part.replace(/^`+|`+$/g, '')
				: part.replace(/<[^>]+>/g, '').replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
		)
		.join('')
		.trim();
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

/** The docs whose backticked paths are checked. */
export function referenceCorpus() {
	return corpusFiles(DOC_DIRS, ['.md']);
}

function main() {
	const missing = DOC_DIRS.filter((dir) => !existsSync(dir));
	if (missing.length > 0) {
		console.error(`codebase-map: ${missing.join(', ')} is missing`);
		process.exit(1);
	}
	const docFiles = referenceCorpus();
	/** @type {Reference[]} */
	const references = [];
	/** @type {string[]} */
	const failures = [];
	for (const file of docFiles) {
		const parsed = referencesIn(file, stripFencedBlocks(readFileSync(file, 'utf8')));
		references.push(...parsed.references);
		failures.push(...parsed.malformed);
	}
	failures.push(...referenceFailures(references, readTree()));

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
