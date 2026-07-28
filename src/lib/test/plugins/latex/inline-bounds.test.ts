// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { BOUNDED_GROWTH_CEILING, measureScanGrowth } from '../../harness/scan-growth';

function resetInlineState(): void {
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}

beforeEach(() => {
	resetInlineState();
	registerMathInline();
});
afterEach(resetInlineState);

const scan = (raw: string) => parseInline(raw, 0, raw.length);
const mathIn = (raw: string) => scan(raw).filter((n) => n.kind === MATH_INLINE);

// `$HOME $PATH $USER …` is ordinary shell prose, and every one of those `$`
// declines — no later `$` has a non-whitespace char before it, so nothing closes.
// A decline that searches to the end of the block costs one full block scan per
// `$`: seconds per keystroke on a large paragraph.
describe('inline math decline bounds', () => {
	it('a $-flood scans within a bounded growth ratio', () => {
		const { times, ratio } = measureScanGrowth(scan, '$x ', [32, 128]);
		expect(ratio, `32KB=${times[0].toFixed(1)}ms 128KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);
	}, 300_000);

	// The bound is a lookup over the same closer predicate, so the greedy first-close
	// reading is unchanged: the opening `$` still reaches past a long declining run
	// to the first `$` with a non-whitespace char before it.
	it('claims greedily through a declining run to the first real closer', () => {
		const raw = '$x '.repeat(400) + '$a+b$ tail';
		expect(mathIn(raw)).toEqual([{ kind: MATH_INLINE, start: 0, end: 1205 }]);
	});

	// The scan range, not the block string, bounds a claim — a closer past `end`
	// must stay invisible or a heading's trailing bytes would be swallowed.
	it('ignores a closer beyond the scan range', () => {
		expect(parseInline('$a$', 0, 2).some((n) => n.kind === MATH_INLINE)).toBe(false);
		expect(parseInline('$a$', 0, 3).some((n) => n.kind === MATH_INLINE)).toBe(true);
	});

	// The other side of the same bound: a heading or list item scans from past its
	// stripped marker, so the index has to answer for a range that does not start at 0.
	it('claims inside a content range that starts past the block start', () => {
		expect(parseInline('## $x$', 3, 6).filter((n) => n.kind === MATH_INLINE)).toEqual([
			{ kind: MATH_INLINE, start: 3, end: 6 }
		]);
	});
});
