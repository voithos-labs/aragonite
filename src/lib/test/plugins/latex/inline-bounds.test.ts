// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parseInline } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerMathInline();
});
afterEach(resetPluginPlatformForTests);

const scan = (raw: string) => parseInline(raw, 0, raw.length);
const mathIn = (raw: string) => scan(raw).filter((n) => n.kind === MATH_INLINE);

// Every `$` in shell prose declines, because the `$` that ends its attempt has whitespace
// before it. A decline that searches to the end of the block would cost one full block scan
// per `$`, seconds per keystroke on a large paragraph.
describe('inline math decline bounds', () => {
	it('a $-flood scans within a bounded growth ratio', () => {
		const growth = measureScanGrowth(scan, '$x ', [32, 128]);
		expectBoundedGrowth(growth);
	}, 300_000);

	// The bound is a lookup, and it answers with the next `$`, whichever one that is: a match
	// ends at the first it meets, so a run of failures is a run of single lookups and the
	// formula at the end keeps its own delimiters.
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
		expect(parseInline('$a$', 0, 2).some((n) => n.kind === MATH_INLINE)).toBe(false);
		expect(parseInline('$a$', 0, 3).some((n) => n.kind === MATH_INLINE)).toBe(true);
	});

	// The other side of the same bound: a heading or list item scans from past its marker,
	// so the index has to answer for a range that does not start at 0.
	it('claims inside a content range that starts past the block start', () => {
		expect(parseInline('## $x$', 3, 6).filter((n) => n.kind === MATH_INLINE)).toEqual([
			{ kind: MATH_INLINE, start: 3, end: 6 }
		]);
	});
});
