/**
 * The repo's private words appear in no comment and no requirement file, and each design or
 * contributing doc holds no more than its baseline (G4.26, vocabulary half). The list holds
 * only words a developer new to the repo cannot decode from English;
 * `docs/contributing/code-style.md` carries the rule and the plain replacements.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { collectEditorSources, collectFiles, EDITOR_SRC, ROUTES_SRC } from './scan-source';
import { corpusFiles } from '../../../../../scripts/doc-corpus.mjs';
import { findCommentBlocks } from './comment-lines';
import { SOURCE_DIR } from './source-paths';

const HOUSE_WORDS = [
	'seam',
	'seams',
	'door',
	'doors',
	'funnel',
	'funnels',
	'funnelled',
	'funneled',
	'rung',
	'rungs',
	'ceremony',
	'ceremonies',
	'mint',
	'mints',
	'minted',
	'minting',
	'peel',
	'peels',
	'peeled',
	'peeling',
	'landable',
	'oracle',
	'oracles',
	'seat',
	'seats',
	'seated',
	'seating',
	'island',
	'islands',
	'ladder',
	'ladders',
	'road',
	'roads',
	'dialect',
	'dialects',
	'sanctioned',
	'owe',
	'owes',
	'husk',
	'husks'
];

const HOUSE_WORD = new RegExp(`\\b(?:${HOUSE_WORDS.join('|')})\\b`, 'gi');

/** Symbol references stay: a backticked name or a `{@link}` is code, not vocabulary. */
function proseOf(commentLine: string): string {
	return commentLine.replace(/`[^`]*`/g, ' ').replace(/\{@link[^}]*\}/g, ' ');
}

export function countHouseWords(text: string, relPath: string): number {
	return findCommentBlocks(text, relPath)
		.flatMap((b) => b.text)
		.reduce((n, line) => n + (proseOf(line).match(HOUSE_WORD)?.length ?? 0), 0);
}

describe('G4.26 no house word in a comment', () => {
	const sources = [
		...collectEditorSources(EDITOR_SRC, { includeTests: true, includeStyles: true }),
		...collectEditorSources(ROUTES_SRC, { includeTests: true, includeStyles: true })
	];

	it('read the library, its tests and the demo routes', () => {
		expect(sources.length).toBeGreaterThan(1000);
		expect(sources.some((f) => f.relPath.startsWith(SOURCE_DIR.routes))).toBe(true);
	});

	// Counted at collection, which no test timeout bounds: the corpus is slow on a busy machine.
	const offenders = sources
		.map((f) => ({ file: f.relPath, hits: countHouseWords(f.text, f.relPath) }))
		.filter((row) => row.hits > 0);

	it('no comment under src/lib or src/routes holds a house word', () => {
		expect(offenders).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('counts a house word in every comment syntax, inflected or capitalised', () => {
		expect(countHouseWords('// the seam between two blocks', 'x.ts')).toBe(1);
		expect(countHouseWords('/** Seams are minted here. */', 'x.ts')).toBe(2);
		expect(countHouseWords('<!-- the caret seats past the island -->', 'x.svelte')).toBe(2);
		expect(countHouseWords('// ── The splice settle funnel ──', 'x.ts')).toBe(1);
		expect(countHouseWords('const a = 1; // the seam', 'x.ts')).toBe(1);
	});

	it('spares English neighbours, code, and symbol references', () => {
		expect(countHouseWords('// seamless, indoors, a mintage, roadmap, seatbelt', 'x.ts')).toBe(0);
		expect(countHouseWords('const seam = door(oracle);', 'x.ts')).toBe(0);
		expect(countHouseWords('// `PasteSeam` reads {@link heightOracle} at the seam', 'x.ts')).toBe(
			1
		);
		expect(countHouseWords("const s = '// the seam';", 'x.ts')).toBe(0);
		expect(countHouseWords('<p>see https://x.dev/seam</p>', 'x.svelte')).toBe(0);
		expect(countHouseWords('{#if a}x{/if}</p>\n<p>see https://x.dev/seam</p>', 'x.svelte')).toBe(0);
	});
});

// ── Requirement files ───────────────────────────────────────────────────────

const REQUIREMENTS = SOURCE_DIR.e2eRequirements;

/** House words in a requirement file's body text. Headings stay as written (specs and docs
 *  point at them), and code spans and fenced samples are code, not vocabulary. */
export function countHouseWordsInRequirement(markdown: string): number {
	let inFence = false;
	let hits = 0;
	for (const line of markdown.split(/\r?\n/)) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence || /^#{1,6}\s/.test(line)) continue;
		hits += proseOf(line).match(HOUSE_WORD)?.length ?? 0;
	}
	return hits;
}

/** Files whose subject is named by a listed word, glossed at its first use. */
const NAMED_BY_A_LISTED_WORD = new Set([
	// The feature's own name, as in `data-decoration-island`, `Island` and `IslandSpan`.
	'decorations/island-editing.md'
]);

describe('G4.26 requirement files keep house words out of their body text', () => {
	const files = collectFiles(REQUIREMENTS, { extensions: ['.md'] });
	// Counted at collection, like the docs below: a 300-file scan can outlast a test's timeout under load.
	const counted = files.map((f) => ({
		file: f.slice(REQUIREMENTS.length),
		hits: countHouseWordsInRequirement(readFileSync(f, 'utf8'))
	}));

	it('found the requirement files', () => {
		expect(files.length).toBeGreaterThan(300);
	});

	it('no requirement file holds a house word outside its headings and code', () => {
		const offenders = counted.filter(
			(row) => row.hits > 0 && !NAMED_BY_A_LISTED_WORD.has(row.file)
		);
		expect(offenders).toEqual([]);
	});

	it('counts body text, and spares headings, code spans and fenced samples', () => {
		expect(countHouseWordsInRequirement('- the caret seats past the island')).toBe(2);
		expect(countHouseWordsInRequirement('## The caret door')).toBe(0);
		expect(countHouseWordsInRequirement('- `seatsInside` decides it')).toBe(0);
		expect(countHouseWordsInRequirement('```md\nthe seam\n```')).toBe(0);
	});
});

// ── Design and contributing docs ────────────────────────────────────────────

/** Hits per doc, counted the way a requirement file's body is; a doc not listed holds none.
 *  Lower a number when a rewrite lands; never raise one. */
const DOC_BASELINE: Record<string, number> = {
	'docs/design/caret-placement.md': 1,
	'docs/design/invariants.md': 97,
	'docs/contributing/anatomy-of-a-change.md': 2,
	'docs/contributing/code-style.md': 4,
	'docs/contributing/first-hour.md': 1,
	'docs/contributing/rules.md': 2,
	'docs/contributing/warnings.md': 1
};

/** The glossary defines the words, so it names every one of them. */
const GLOSSARY = 'docs/contributing/glossary.md';

describe('G4.26 design and contributing docs stay under their house-word baseline', () => {
	const docs = corpusFiles(['docs/design', 'docs/contributing'], ['.md']).filter(
		(doc) => doc !== GLOSSARY
	);
	const counts = new Map(
		docs.map((doc) => [doc, countHouseWordsInRequirement(readFileSync(doc, 'utf8'))])
	);

	it('read the design and contributing docs', () => {
		expect(docs).toContain('docs/design/editor.md');
		expect(docs).toContain('docs/contributing/rules.md');
	});

	it('no doc holds more house words in its body text than its baseline', () => {
		const over = [...counts]
			.filter(([doc, n]) => n > (DOC_BASELINE[doc] ?? 0))
			.map(([doc, n]) => ({ doc, count: n, baseline: DOC_BASELINE[doc] ?? 0 }));
		expect(over).toEqual([]);
	});

	it('no baseline sits above its count (lower it when a rewrite lands)', () => {
		const stale = Object.entries(DOC_BASELINE)
			.filter(([doc, n]) => n > (counts.get(doc) ?? 0))
			.map(([doc, n]) => ({ doc, count: counts.get(doc) ?? 0, baseline: n }));
		expect(stale).toEqual([]);
	});
});
