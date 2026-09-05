// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerFootnoteReference } from '$lib/plugins/footnotes/footnote-reference';
import { FOOTNOTE_REF_KIND } from '$lib/plugins/footnotes/constants';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerFootnoteReference();
});
afterEach(resetPluginPlatformForTests);

const scan = (raw: string) => parseInline(raw, 0, raw.length);
const refsIn = (raw: string) => scan(raw).filter((n) => n.kind === FOOTNOTE_REF_KIND);

// An unterminated `[^` searched to the end of the block before declining, so a
// paragraph carrying many of them paid one full block scan per reference. The label
// terminators (`]` and whitespace) are indexed once per block instead.
describe('footnote reference decline bounds', () => {
	it('an unterminated-[^ flood scans within a bounded growth ratio', () => {
		const growth = measureScanGrowth(scan, '[^x', [32, 128]);
		expectBoundedGrowth(growth);
	}, 300_000);

	// The label alphabet is unchanged by the bound: `[` is still label content, so a
	// nested-looking reference still closes on its first `]`.
	it('keeps the label alphabet: [ is content, the first ] closes', () => {
		expect(refsIn('[^nested[^x]]')).toEqual([
			{ kind: FOOTNOTE_REF_KIND, start: 0, end: 12, label: 'nested[^x' }
		]);
	});

	// The scan range, not the block string, bounds a claim — a `]` past `end` must
	// stay invisible.
	it('ignores a closing bracket beyond the scan range', () => {
		expect(parseInline('[^a]', 0, 3).some((n) => n.kind === FOOTNOTE_REF_KIND)).toBe(false);
		expect(parseInline('[^a]', 0, 4).some((n) => n.kind === FOOTNOTE_REF_KIND)).toBe(true);
	});

	// A soft line break inside a paragraph puts `\r` in the label's path, and the
	// terminator index carries the whole `\s` class the scan did — so a CRLF block
	// declines exactly where an LF one does.
	it('declines a label broken by a CRLF line ending', () => {
		expect(refsIn('[^a\r\n]')).toEqual([]);
		expect(refsIn('[^a]\r\n')).toEqual([{ kind: FOOTNOTE_REF_KIND, start: 0, end: 4, label: 'a' }]);
	});
});
