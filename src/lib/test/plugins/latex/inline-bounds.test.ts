import { beforeEach, describe, it, expect } from 'vitest';
import { parseInline, type InlineNode } from '#lib';
import { listGrammar } from '#lib/schema/own-syntax.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { latex } from '#packages/latex/src/index.js';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

const MATH_INLINE = 'latex/math';

// An editor running latex reads with this; made per row, since the suite's reset after each row
// drops what an install held.
let math: GrammarView;
beforeEach(() => {
	math = listGrammar([latex], ({ cause }) => {
		throw cause;
	}).grammar as GrammarView;
});

const scan = (raw: string) => parseInline(raw, 0, raw.length, undefined, math);
const spans = (nodes: InlineNode[]) =>
	nodes.filter((n) => n.kind === MATH_INLINE).map(({ kind, start, end }) => ({ kind, start, end }));
const mathIn = (raw: string) => spans(scan(raw));

// Every `$` in shell prose declines, and a decline that searched to the block's end would cost
// a full block scan per `$`, seconds per keystroke on a large paragraph.
describe('inline math decline bounds', () => {
	it('a $-flood scans within a bounded growth ratio', () => {
		const growth = measureScanGrowth(scan, '$x ', [32, 128]);
		expectBoundedGrowth(growth);
	}, 300_000);

	// The bound answers with the next `$`, and a match ends at the first it meets, so a run of
	// failures is a run of single lookups and the formula at the end keeps its delimiters.
	it('ends each attempt at the next $, so a declining run claims nothing', () => {
		const raw = '$x '.repeat(400) + '$a+b$ tail';
		expect(mathIn(raw)).toEqual([{ kind: MATH_INLINE, start: 1200, end: 1205 }]);
	});

	// `$$` is the display fence or a just-closed empty pair, never an opener: a match from it
	// would end on the second `$` of that pair.
	it('a $$ run opens nothing, so a later formula keeps its own delimiters', () => {
		expect(mathIn('$$ and $x^2$ later')).toEqual([{ kind: MATH_INLINE, start: 7, end: 12 }]);
		expect(mathIn('$$x$$')).toEqual([{ kind: MATH_INLINE, start: 1, end: 4 }]);
	});

	// The scan range, not the whole block, is what bounds a match: a closer past `end`
	// must stay invisible, or a heading's trailing bytes would be swallowed.
	it('ignores a closer beyond the scan range', () => {
		expect(parseInline('$a$', 0, 2, undefined, math).some((n) => n.kind === MATH_INLINE)).toBe(
			false
		);
		expect(parseInline('$a$', 0, 3, undefined, math).some((n) => n.kind === MATH_INLINE)).toBe(
			true
		);
	});

	// The other side of the same bound: a heading or list item scans from past its marker,
	// so the search has to answer for a range that does not start at 0.
	it('claims inside a content range that starts past the block start', () => {
		expect(spans(parseInline('## $x$', 3, 6, undefined, math))).toEqual([
			{ kind: MATH_INLINE, start: 3, end: 6 }
		]);
	});
});
