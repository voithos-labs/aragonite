/**
 * G4.26, the vocabulary half: the repo's private words may not appear in comments more often
 * than each directory's baseline records, and a baseline drops the moment a rewrite lowers
 * the count. The list holds only words a developer new to the repo cannot decode from
 * English; `docs/contributing/code-style.md` carries the rule and the plain replacements.
 */

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
	'src/lib': 71,
	'src/lib/ambient': 5,
	'src/lib/components': 354,
	'src/lib/core': 0,
	'src/lib/cursor': 98,
	'src/lib/decorations': 20,
	'src/lib/e2e': 539,
	'src/lib/editor-actions': 0,
	'src/lib/invariants': 19,
	'src/lib/perf': 1,
	'src/lib/plugins': 24,
	'src/lib/reactivity': 21,
	'src/lib/schema': 37,
	'src/lib/search': 3,
	'src/lib/selection': 0,
	'src/lib/styles': 5,
	'src/lib/test': 2,
	'src/lib/test/ambient': 1,
	'src/lib/test/blocks': 260,
	'src/lib/test/components': 18,
	'src/lib/test/core': 0,
	'src/lib/test/cursor': 66,
	'src/lib/test/debug': 1,
	'src/lib/test/decorations': 11,
	'src/lib/test/editor-actions': 0,
	'src/lib/test/gfm-conformance': 0,
	'src/lib/test/harness': 24,
	'src/lib/test/image': 8,
	'src/lib/test/invariants': 258,
	'src/lib/test/perf': 8,
	'src/lib/test/plugins': 91,
	'src/lib/test/reactivity': 21,
	'src/lib/test/schema': 64,
	'src/lib/test/search': 1,
	'src/lib/test/selection': 0,
	'src/lib/test/simulation': 56,
	'src/lib/test/support': 4,
	'src/lib/test/tree-operations': 0,
	'src/lib/test/undo': 7,
	'src/lib/testing': 48,
	'src/lib/tree-operations': 0,
	'src/routes': 46
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

/** `src/lib/<dir>` for library files (`src/lib/test/<dir>` for unit tests, so each rewrite pass owns
 *  its own numbers), `src/lib` for its root files, `src/routes` for the rest. */
function directoryOf(relPath: string): string {
	const parts = relPath.split('/');
	if (parts[1] === 'routes') return 'src/routes';
	const depth = parts[2] === 'test' && parts.length > 4 ? 4 : 3;
	return parts.length > depth ? parts.slice(0, depth).join('/') : 'src/lib';
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
