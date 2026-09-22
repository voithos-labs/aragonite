/**
 * G4.26, the vocabulary half: the repo's private words may not appear in comments more often
 * than each directory's baseline records, and a baseline drops the moment a rewrite lowers
 * the count. The list holds only words a developer new to the repo cannot decode from
 * English; `docs/contributing/code-style.md` carries the rule and the plain replacements.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, ROUTES_SRC } from './scan-source';
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

/** Hits per directory. Lower a number when a rewrite lands; never raise one. */
const BASELINE: Record<string, number> = {
	'src/lib': 0,
	'src/lib/ambient': 0,
	'src/lib/components': 0,
	'src/lib/core': 0,
	'src/lib/cursor': 0,
	'src/lib/decorations': 0,
	'src/lib/e2e': 0,
	'src/lib/editor-actions': 0,
	'src/lib/inline-menu': 0,
	'src/lib/invariants': 0,
	'src/lib/perf': 0,
	'src/lib/plugins': 0,
	'src/lib/reactivity': 0,
	'src/lib/schema': 0,
	'src/lib/search': 0,
	'src/lib/selection': 0,
	'src/lib/styles': 0,
	'src/lib/test': 0,
	'src/lib/test/ambient': 0,
	'src/lib/test/blocks': 0,
	'src/lib/test/components': 0,
	'src/lib/test/core': 0,
	'src/lib/test/cursor': 0,
	'src/lib/test/debug': 0,
	'src/lib/test/decorations': 0,
	'src/lib/test/editor-actions': 0,
	'src/lib/test/gfm-conformance': 0,
	'src/lib/test/harness': 0,
	'src/lib/test/image': 0,
	'src/lib/test/invariants': 0,
	'src/lib/test/perf': 0,
	'src/lib/test/plugins': 0,
	'src/lib/test/reactivity': 0,
	'src/lib/test/schema': 0,
	'src/lib/test/search': 0,
	'src/lib/test/selection': 0,
	'src/lib/test/simulation': 0,
	'src/lib/test/support': 0,
	'src/lib/test/tree-operations': 0,
	'src/lib/test/undo': 0,
	'src/lib/testing': 0,
	'src/lib/tree-operations': 0,
	'src/routes': 0,
	'src/lib/components/blocks': 0,
	'src/lib/components/image': 0,
	'src/lib/components/link-card': 0,
	'src/lib/components/menu': 0,
	'src/lib/e2e/simulation': 0,
	'src/lib/e2e/simulation/gestures': 0,
	'src/lib/e2e/simulation/notes': 0,
	'src/lib/e2e/tests': 0,
	'src/lib/e2e/tests/blocks': 0,
	'src/lib/e2e/tests/capture': 0,
	'src/lib/e2e/tests/clipboard': 0,
	'src/lib/e2e/tests/decorations': 0,
	'src/lib/e2e/tests/keyboard-navigation': 0,
	'src/lib/e2e/tests/perf': 0,
	'src/lib/e2e/tests/plugins': 0,
	'src/lib/e2e/tests/presentation': 0,
	'src/lib/e2e/tests/search': 0,
	'src/lib/e2e/tests/selection': 0,
	'src/lib/e2e/tests/simulation': 0,
	'src/lib/e2e/tests/text-editing': 0,
	'src/lib/e2e/tests/webkit': 0
};

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

/** How many path segments name a row: deeper where several rewrite passes share one tree. */
const ROW_DEPTH: Record<string, number> = { test: 4, components: 4, e2e: 5 };

/** The baseline row a file counts toward: its directory, cut at that tree's row depth. */
function directoryOf(relPath: string): string {
	const parts = relPath.split('/');
	if (parts[1] === 'routes') return 'src/routes';
	const depth = ROW_DEPTH[parts[2]] ?? 3;
	return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

describe('G4.26 house words in comments stay under the baseline', () => {
	const sources = [
		...collectEditorSources(EDITOR_SRC, { includeTests: true, includeStyles: true }),
		...collectEditorSources(ROUTES_SRC, { includeTests: true, includeStyles: true })
	];
	const counts: Record<string, number> = {};
	for (const file of sources) {
		const dir = directoryOf(file.relPath);
		counts[dir] = (counts[dir] ?? 0) + countHouseWords(file.text);
	}

	it('no directory holds more house words in comments than its baseline', () => {
		const over = Object.entries(counts)
			.filter(([dir, n]) => n > (BASELINE[dir] ?? 0))
			.map(([dir, n]) => ({ dir, count: n, baseline: BASELINE[dir] ?? 0 }));
		expect(over).toEqual([]);
	});

	it('no baseline sits above its count (lower it when a rewrite lands)', () => {
		const stale = Object.entries(BASELINE)
			.filter(([dir, n]) => n > (counts[dir] ?? 0))
			.map(([dir, n]) => ({ dir, count: counts[dir] ?? 0, baseline: n }));
		expect(stale).toEqual([]);
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

const REQUIREMENTS = path.join(EDITOR_SRC, 'e2e', 'requirements');

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
	const files = (readdirSync(REQUIREMENTS, { recursive: true }) as string[]).filter((f) =>
		f.endsWith('.md')
	);

	it('found the requirement files', () => {
		expect(files.length).toBeGreaterThan(300);
	});

	it('no requirement file holds a house word outside its headings and code', () => {
		const offenders = files
			.map((f) => ({
				file: f.split(path.sep).join('/'),
				hits: countHouseWordsInRequirement(readFileSync(path.join(REQUIREMENTS, f), 'utf8'))
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

const DOCS = path.resolve('docs');

/** Hits per doc, counted the way a requirement file's body is. Lower a number when a rewrite
 *  lands; never raise one. The glossary defines the words, and releasing.md is an owner file
 *  outside the repository, so neither is a row. */
const DOC_BASELINE: Record<string, number> = {
	'design/caret-placement.md': 7,
	'design/editor.md': 0,
	'design/inline-parsing.md': 0,
	'design/invariants.md': 147,
	'design/live-mode.md': 0,
	'design/performance.md': 1,
	'design/plugin-contract.md': 82,
	'design/syntax-tree.md': 0,
	'design/virtual-rendering.md': 0,
	'contributing/adding-a-block.md': 1,
	'contributing/anatomy-of-a-change.md': 2,
	'contributing/casebook.md': 7,
	'contributing/code-style.md': 15,
	'contributing/codebase-map.md': 0,
	'contributing/commit-conventions.md': 0,
	'contributing/debugging.md': 0,
	'contributing/first-hour.md': 1,
	'contributing/rules.md': 18,
	'contributing/testing.md': 10,
	'contributing/warnings.md': 1
};

const NOT_A_DOC_ROW = new Set(['glossary.md', 'releasing.md']);

describe('G4.26 design and contributing docs stay under their house-word baseline', () => {
	const counts: Record<string, number> = {};
	for (const rel of Object.keys(DOC_BASELINE)) {
		counts[rel] = countHouseWordsInRequirement(readFileSync(path.join(DOCS, rel), 'utf8'));
	}

	it('no doc holds more house words in its body text than its baseline', () => {
		const over = Object.entries(counts)
			.filter(([rel, n]) => n > DOC_BASELINE[rel])
			.map(([rel, n]) => ({ doc: rel, count: n, baseline: DOC_BASELINE[rel] }));
		expect(over).toEqual([]);
	});

	it('no baseline sits above its count (lower it when a rewrite lands)', () => {
		const stale = Object.entries(DOC_BASELINE)
			.filter(([rel, n]) => n > counts[rel])
			.map(([rel, n]) => ({ doc: rel, count: counts[rel], baseline: n }));
		expect(stale).toEqual([]);
	});

	it('every design and contributing doc is a row', () => {
		const onDisk = ['design', 'contributing'].flatMap((dir) =>
			readdirSync(path.join(DOCS, dir))
				.filter((f) => f.endsWith('.md') && !NOT_A_DOC_ROW.has(f))
				.map((f) => `${dir}/${f}`)
		);
		expect(onDisk.sort()).toEqual(Object.keys(DOC_BASELINE).sort());
	});
});
