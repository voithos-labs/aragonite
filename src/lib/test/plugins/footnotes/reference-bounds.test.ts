import { beforeEach, describe, expect, it } from 'vitest';
import { parseInline } from '#lib';
import { REFERENCE, footnotesGrammar } from '#lib/test/support/footnotes-grammar.js';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

let grammar: ReturnType<typeof footnotesGrammar>;
const scan = (raw: string) => parseInline(raw, 0, raw.length, undefined, grammar);
const refsIn = (raw: string) => scan(raw).filter((n) => n.kind === REFERENCE);

beforeEach(() => {
	grammar = footnotesGrammar();
});

// An unterminated `[^` would search to the block's end before backing out, so a flood of them must
// not search once per `[^`.
describe('footnote reference decline bounds', () => {
	it('an unterminated-[^ flood scans within a bounded growth ratio', () => {
		const growth = measureScanGrowth(scan, '[^x', [32, 128]);
		expectBoundedGrowth(growth);
	}, 300_000);

	// `[` is still label content, so a nested-looking reference still closes on its first `]`.
	it('keeps the label alphabet: [ is content, the first ] closes', () => {
		expect(refsIn('[^nested[^x]]')).toMatchObject([
			{ kind: REFERENCE, start: 0, end: 12, data: 'nested[^x' }
		]);
	});

	// The scan range, not the whole block, is what bounds a match: a `]` past `end` must stay
	// invisible.
	it('ignores a closing bracket beyond the scan range', () => {
		const within = (end: number) => parseInline('[^a]', 0, end, undefined, grammar);
		expect(within(3).some((n) => n.kind === REFERENCE)).toBe(false);
		expect(within(4).some((n) => n.kind === REFERENCE)).toBe(true);
	});

	// A soft line break puts `\r` in the label, and the terminator covers every Markdown
	// whitespace character, so a CRLF block backs out exactly where an LF one does.
	it('declines a label broken by a CRLF line ending', () => {
		expect(refsIn('[^a\r\n]')).toEqual([]);
		expect(refsIn('[^a]\r\n')).toMatchObject([{ kind: REFERENCE, start: 0, end: 4, data: 'a' }]);
	});
});

// Miss-analysis: every label case was ASCII, never one holding a non-breaking space.
describe('footnote reference label whitespace', () => {
	it('ends a label at a tab, and reads a non-breaking space as part of it', () => {
		expect(refsIn('[^a\tb]')).toEqual([]);
		expect(refsIn('[^a\u00a0b]')).toMatchObject([
			{ kind: REFERENCE, start: 0, end: 6, data: 'a\u00a0b' }
		]);
	});
});
