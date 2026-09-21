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
	'src/lib': 0,
	'src/lib/ambient': 0,
	'src/lib/components': 0,
	'src/lib/core': 0,
	'src/lib/cursor': 0,
	'src/lib/decorations': 0,
	'src/lib/e2e': 0,
	'src/lib/editor-actions': 0,
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
	'src/lib/test/simulation': 56,
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
	'src/lib/e2e/tests/blocks': 47,
	'src/lib/e2e/tests/capture': 0,
	'src/lib/e2e/tests/clipboard': 0,
	'src/lib/e2e/tests/decorations': 0,
	'src/lib/e2e/tests/keyboard-navigation': 0,
	'src/lib/e2e/tests/perf': 0,
	'src/lib/e2e/tests/plugins': 0,
	'src/lib/e2e/tests/presentation': 0,
	'src/lib/e2e/tests/search': 0,
	'src/lib/e2e/tests/selection': 38,
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
