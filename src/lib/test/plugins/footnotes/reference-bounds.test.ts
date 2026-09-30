// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { parseInline } from '$lib';
import { registerFootnoteReference } from '$lib/plugins/footnotes/footnote-reference';
import { FOOTNOTE_REF_KIND } from '$lib/plugins/footnotes/constants';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

beforeEach(() => {
	registerFootnoteReference();
});

const scan = (raw: string) => parseInline(raw, 0, raw.length);
const refsIn = (raw: string) => scan(raw).filter((n) => n.kind === FOOTNOTE_REF_KIND);

// An unterminated `[^` would search to the block's end before backing out, so the label
// terminators (`]` and whitespace) are indexed once per block rather than scanned per `[^`.
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

	// The scan range, not the whole block, is what bounds a match: a `]` past `end`
	// must stay invisible.
	it('ignores a closing bracket beyond the scan range', () => {
		expect(parseInline('[^a]', 0, 3).some((n) => n.kind === FOOTNOTE_REF_KIND)).toBe(false);
		expect(parseInline('[^a]', 0, 4).some((n) => n.kind === FOOTNOTE_REF_KIND)).toBe(true);
	});

	// A soft line break puts `\r` in the label, and the terminator covers every Markdown
	// whitespace character, so a CRLF block backs out exactly where an LF one does.
	it('declines a label broken by a CRLF line ending', () => {
		expect(refsIn('[^a\r\n]')).toEqual([]);
		expect(refsIn('[^a]\r\n')).toEqual([{ kind: FOOTNOTE_REF_KIND, start: 0, end: 4, label: 'a' }]);
	});
});

// Miss-analysis: every label case was ASCII, never one holding a non-breaking space.
describe('footnote reference label whitespace', () => {
	it('ends a label at a tab, and reads a non-breaking space as part of it', () => {
		expect(refsIn('[^a\tb]')).toEqual([]);
		expect(refsIn('[^a\u00a0b]')).toEqual([
			{ kind: FOOTNOTE_REF_KIND, start: 0, end: 6, label: 'a\u00a0b' }
		]);
	});
});
