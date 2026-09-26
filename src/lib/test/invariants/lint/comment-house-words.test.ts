/**
 * G4.26, the vocabulary half: the repo's private words appear in no comment and no requirement
 * file, and each design or contributing doc holds no more than its baseline. The list holds
 * only words a developer new to the repo cannot decode from English;
 * `docs/contributing/code-style.md` carries the rule and the plain replacements.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { collectEditorSources, collectFiles, EDITOR_SRC, ROUTES_SRC } from './scan-source';
import { corpusFiles } from '../../../../../scripts/doc-corpus.mjs';
import { findCommentBlocks } from './comment-lines';

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

export function countHouseWords(text: string): number {
	return findCommentBlocks(text)
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
		expect(sources.some((f) => f.relPath.startsWith('src/routes/'))).toBe(true);
	});

	it('no comment under src/lib or src/routes holds a house word', () => {
		const offenders = sources
			.map((f) => ({ file: f.relPath, hits: countHouseWords(f.text) }))
			.filter((row) => row.hits > 0);
		expect(offenders).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('counts a house word in every comment syntax, inflected or capitalised', () => {
		expect(countHouseWords('// the seam between two blocks')).toBe(1);
		expect(countHouseWords('/** Seams are minted here. */')).toBe(2);
		expect(countHouseWords('<!-- the caret seats past the island -->')).toBe(2);
		expect(countHouseWords('// ── The splice settle funnel ──')).toBe(1);
	});

	it('spares English neighbours, code, and symbol references', () => {
		expect(countHouseWords('// seamless, indoors, a mintage, roadmap, seatbelt')).toBe(0);
		expect(countHouseWords('const seam = door(oracle);')).toBe(0);
		expect(countHouseWords('// `PasteSeam` reads {@link heightOracle} at the seam')).toBe(1);
	});
});

// ── Requirement files ───────────────────────────────────────────────────────

const REQUIREMENTS = 'src/lib/e2e/requirements';

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

	it('found the requirement files', () => {
		expect(files.length).toBeGreaterThan(300);
	});

	it('no requirement file holds a house word outside its headings and code', () => {
		const offenders = files
			.map((f) => ({
				file: f.slice(REQUIREMENTS.length + 1),
				hits: countHouseWordsInRequirement(readFileSync(f, 'utf8'))
			}))
			.filter((row) => row.hits > 0 && !NAMED_BY_A_LISTED_WORD.has(row.file));
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
	'docs/design/invariants.md': 131,
	'docs/design/performance.md': 1,
	'docs/design/plugin-contract.md': 79,
	'docs/contributing/adding-a-block.md': 1,
	'docs/contributing/anatomy-of-a-change.md': 2,
	'docs/contributing/casebook.md': 7,
	'docs/contributing/code-style.md': 15,
	'docs/contributing/first-hour.md': 1,
	'docs/contributing/rules.md': 18,
	'docs/contributing/testing.md': 10,
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
