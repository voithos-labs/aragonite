/**
 * The repo's private words appear in no comment and no requirement file, and each design or
 * contributing doc holds no more than its baseline (G4.26, vocabulary half). The table below holds
 * each word a developer new to the repo can't decode from English and the plain phrase to write
 * instead, which every failure quotes. `docs/contributing/code-style.md` carries the rule.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { collectEditorSources, collectFiles, LIBRARY_ROOTS, ROUTES_SRC } from './scan-source';
import { corpusFiles } from '../../../../../scripts/docs/doc-corpus.mjs';
import { findCommentBlocks } from './comment-lines';
import { SOURCE_DIR } from './source-paths';

/** A banned word: every form the scan matches, lowercase, and the phrase to write instead. */
interface HouseWord {
	forms: readonly [string, ...string[]];
	write: string;
}

// Only words with no plain-English reading: "fold" or "surface" would flag real sentences.
const HOUSE_WORDS: readonly HouseWord[] = [
	{
		forms: ['seam', 'seams'],
		write: "'the join between two blocks' or 'the boundary between X and Y', or name the function"
	},
	{ forms: ['door', 'doors'], write: "'the one entry point' or 'the only place that writes X'" },
	{
		forms: ['funnel', 'funnels', 'funnelled', 'funneled'],
		write: "'the one call every path goes through'"
	},
	{ forms: ['rung', 'rungs'], write: "'an inline syntax handler' or 'one priority level'" },
	{ forms: ['ceremony', 'ceremonies'], write: "'the commit steps', or name the steps" },
	{ forms: ['mint', 'mints', 'minted', 'minting'], write: "'create'" },
	{
		forms: ['peel', 'peels', 'peeled', 'peeling'],
		write: "'strip the marker' or 'unwrap one level'"
	},
	{ forms: ['landable'], write: "'an offset the caret can sit at'" },
	{
		forms: ['oracle', 'oracles'],
		write: "'the height estimator', or in a test 'the expected result'"
	},
	{
		forms: ['seat', 'seats', 'seated', 'seating'],
		write: "'the caret position' or 'put the caret at'"
	},
	{ forms: ['island', 'islands'], write: "'an inline widget' or 'a non-editable widget'" },
	{ forms: ['ladder', 'ladders'], write: "'the priority order' or 'first match wins'" },
	{ forms: ['road', 'roads'], write: "'the shared path' or 'the same code path as X'" },
	{
		forms: ['dialect', 'dialects'],
		write: "'a document-absolute path' or 'a path relative to this container'"
	},
	{ forms: ['sanctioned'], write: "'the only allowed way' or 'the supported path'" },
	{ forms: ['owe', 'owes'], write: "'must' or 'has to'" },
	{ forms: ['husk', 'husks'], write: "'an empty leftover block'" }
];

const WRITE_FOR = new Map(HOUSE_WORDS.flatMap((w) => w.forms.map((form) => [form, w.write])));

const HOUSE_WORD = new RegExp(`\\b(?:${[...WRITE_FOR.keys()].join('|')})\\b`, 'gi');

/** One banned word found: the line it's on, the word as written, and the phrase to use. */
interface HouseWordHit {
	line: number;
	word: string;
	write: string;
}

export function describeHit(file: string, hit: HouseWordHit): string {
	return `${file}:${hit.line} says '${hit.word}'; write ${hit.write}`;
}

/** Symbol references stay: a backticked name or a `{@link}` is code, not vocabulary. */
function hitsIn(text: string, line: number): HouseWordHit[] {
	const prose = text.replace(/`[^`]*`/g, ' ').replace(/\{@link[^}]*\}/g, ' ');
	return [...prose.matchAll(HOUSE_WORD)].map(([word]) => ({
		line,
		word,
		write: WRITE_FOR.get(word.toLowerCase()) ?? ''
	}));
}

/** A hit in a comment carries the line its comment block starts on. */
export function findHouseWords(text: string, relPath: string): HouseWordHit[] {
	return findCommentBlocks(text, relPath).flatMap((b) => b.text.flatMap((t) => hitsIn(t, b.line)));
}

export function countHouseWords(text: string, relPath: string): number {
	return findHouseWords(text, relPath).length;
}

describe('G4.26 no house word in a comment', () => {
	const sources = [
		...collectEditorSources(LIBRARY_ROOTS, { includeTests: true, includeStyles: true }),
		...collectEditorSources(ROUTES_SRC, { includeTests: true, includeStyles: true })
	];

	it('read the library, its tests and the demo routes', () => {
		expect(sources.length).toBeGreaterThan(1000);
		expect(sources.some((f) => f.relPath.startsWith(SOURCE_DIR.routes))).toBe(true);
	});

	// Counted at collection, which no test timeout bounds: the corpus is slow on a busy machine.
	const failures = sources.flatMap((f) =>
		findHouseWords(f.text, f.relPath).map((hit) => describeHit(f.relPath, hit))
	);

	it('no comment under src/lib or src/routes holds a house word', () => {
		expect(failures).toEqual([]);
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

	it('a failure names the place, the word as written, and what to write instead', () => {
		const code = 'const a = 1;\n/**\n * Seams meet here.\n */\nconst b = 2;';
		const hits = findHouseWords(code, 'x.ts');
		expect(hits.map((hit) => describeHit('x.ts', hit))).toEqual([
			`x.ts:2 says 'Seams'; write ${writeFor('seams')}`
		]);
		expect(writeFor('seams')).toContain('the boundary between');
		expect(findHouseWordsInMarkdown('# T\n\n- the caret seats here')).toEqual([
			{ line: 3, word: 'seats', write: writeFor('seats') }
		]);
	});

	it('every banned word carries a phrase to write instead, and each form is lowercase and unique', () => {
		expect(HOUSE_WORDS.filter((w) => !w.write?.trim()).map((w) => w.forms[0])).toEqual([]);
		const forms = HOUSE_WORDS.flatMap((w) => w.forms);
		const misfiled = forms.filter((f, i) => forms.indexOf(f) !== i || f !== f.toLowerCase());
		expect(misfiled).toEqual([]);
	});
});

function writeFor(form: string): string | undefined {
	return HOUSE_WORDS.find((w) => w.forms.includes(form))?.write;
}

// ── Requirement files ───────────────────────────────────────────────────────

const REQUIREMENTS = SOURCE_DIR.e2eRequirements;

/** House words in a Markdown file's body text. Headings stay as written (specs and docs
 *  point at them), and code spans and fenced samples are code, not vocabulary. */
export function findHouseWordsInMarkdown(markdown: string): HouseWordHit[] {
	let inFence = false;
	const hits: HouseWordHit[] = [];
	markdown.split(/\r?\n/).forEach((line, i) => {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			return;
		}
		if (!inFence && !/^#{1,6}\s/.test(line)) hits.push(...hitsIn(line, i + 1));
	});
	return hits;
}

export function countHouseWordsInRequirement(markdown: string): number {
	return findHouseWordsInMarkdown(markdown).length;
}

/** Files whose subject is named by a listed word, glossed at its first use. */
const NAMED_BY_A_LISTED_WORD = new Set([
	// The feature's own name, as in `data-decoration-island`, `Island` and `IslandSpan`.
	'decorations/island-editing.md'
]);

describe('G4.26 requirement files keep house words out of their body text', () => {
	const files = collectFiles(REQUIREMENTS, { extensions: ['.md'] });
	// Counted at collection, like the docs below: a 300-file scan can outlast a test's timeout under load.
	const failures = files
		.filter((f) => !NAMED_BY_A_LISTED_WORD.has(f.slice(REQUIREMENTS.length)))
		.flatMap((f) =>
			findHouseWordsInMarkdown(readFileSync(f, 'utf8')).map((hit) => describeHit(f, hit))
		);

	it('found the requirement files', () => {
		expect(files.length).toBeGreaterThan(300);
	});

	it('no requirement file holds a house word outside its headings and code', () => {
		expect(failures).toEqual([]);
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
	'docs/design/invariants.md': 2
};

/** The glossary glosses the banned words symbol names still carry, so it names them. */
const GLOSSARY = 'docs/contributing/glossary.md';

describe('G4.26 design and contributing docs stay under their house-word baseline', () => {
	const docs = corpusFiles(['docs/design', 'docs/contributing'], ['.md']).filter(
		(doc) => doc !== GLOSSARY
	);
	const hitsByDoc = new Map(
		docs.map((doc) => [doc, findHouseWordsInMarkdown(readFileSync(doc, 'utf8'))])
	);
	const baselineOf = (doc: string) => DOC_BASELINE[doc] ?? 0;

	it('read the design and contributing docs', () => {
		expect(docs).toContain('docs/design/editor.md');
		expect(docs).toContain('docs/contributing/rules.md');
	});

	it('no doc holds more house words in its body text than its baseline', () => {
		const over = [...hitsByDoc]
			.filter(([doc, hits]) => hits.length > baselineOf(doc))
			.flatMap(([doc, hits]) => [
				`${doc} holds ${hits.length} banned words, its baseline is ${baselineOf(doc)}`,
				...hits.map((hit) => describeHit(doc, hit))
			]);
		expect(over).toEqual([]);
	});

	it('no baseline sits above its count (lower it when a rewrite lands)', () => {
		const stale = Object.entries(DOC_BASELINE).flatMap(([doc, n]) => {
			const count = hitsByDoc.get(doc)?.length ?? 0;
			return count < n
				? [`${doc} holds ${count} banned words; lower its baseline from ${n} to ${count}`]
				: [];
		});
		expect(stale).toEqual([]);
	});
});
