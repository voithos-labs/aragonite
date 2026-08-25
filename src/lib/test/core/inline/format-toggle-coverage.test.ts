// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/core/inline/format-toggle';
import { MARK_FORMATS, markersOf, toggleFormat, whole } from './format-toggle-fixture';

// Coverage routing: a selection already covered by a same-format construct unapplies (splitting
// the construct), and a selection overlapping or abutting same-format runs applies over the union
// (absorbing their markers). Miss-analysis: every unapply case aligned the selection with a
// construct boundary — whole content, or markers included — so no test ever selected a strict
// sub-range of formatted content, and the fall-through to the wrap arm went unobserved.

const PROSE_FORMATS = MARK_FORMATS.filter((f) => f !== 'inlineCode');

describe('a selection inside a same-format construct splits it', () => {
	it.each(PROSE_FORMATS)('unwraps the tail of the content (%s)', (format) => {
		const m = markersOf(format);
		const raw = `${m}text text2${m}`;
		const at = m.length + 5;
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: at, end: at + 5 } },
			format
		);
		expect(r.newDisplay).toBe(`${m}text${m} text2`);
		expect(r.newDisplay.slice(r.newSelStart, r.newSelEnd)).toBe('text2');
	});

	it('unwraps the head of the content', () => {
		const raw = '**text text2**';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 2, end: 6 } },
			'strong'
		);
		expect(r.newDisplay).toBe('text **text2**');
		expect(r.newSelStart).toBe(0);
		expect(r.newSelEnd).toBe(4);
	});

	it('splits around a middle selection, both halves keeping the format', () => {
		const raw = '**a b c**';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 4, end: 5 } },
			'strong'
		);
		expect(r.newDisplay).toBe('**a** b **c**');
		expect(r.newDisplay.slice(r.newSelStart, r.newSelEnd)).toBe('b');
	});

	it('unwraps the whole construct when the selection reaches into both marker runs', () => {
		const raw = '**text text2**';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 1, end: 13 } },
			'strong'
		);
		expect(r.newDisplay).toBe('text text2');
	});

	it('re-emits the construct with its own non-canonical delimiters', () => {
		const raw = '__text text2__';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 7, end: 12 } },
			'strong'
		);
		expect(r.newDisplay).toBe('__text__ text2');
	});

	it('keeps a boundary space inside a split code span', () => {
		const raw = '`ab cd`';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 4, end: 6 } },
			'inlineCode'
		);
		expect(r.newDisplay).toBe('`ab `cd');
	});

	it('splits around a whitespace-only selection', () => {
		const raw = '**a b**';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 3, end: 4 } },
			'strong'
		);
		expect(r.newDisplay).toBe('**a** **b**');
	});

	it('splits identically in live mode, where no marker paints', () => {
		const raw = '**text text2**';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 7, end: 12 } },
			'strong',
			'live'
		);
		expect(r?.newDisplay).toBe('**text** text2');
	});

	// In strong(`x ** y`) the inner `**` is literal content that happens to equal the delimiter
	// run, and no candidate can close a run against it: the press declines over eating it.
	// Miss-analysis: the flank arm's byte-equality check was never handed flanking bytes that were
	// content — every strip case's flanks were a parsed construct's real delimiters.
	it('declines when the flanking bytes are literal content, not the construct delimiters', () => {
		const raw = '**x ** y**';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 6, end: 8 } },
			'strong',
			'source'
		);
		expect(r).toBeNull();
	});

	// The cut lands inside a different construct nested in the bold, so every candidate strands a
	// delimiter and changes the screen: no verification, no rewrite.
	it('declines a cut that would strand another construct’s delimiters', () => {
		const raw = '**a *b c* d**';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 7, end: 11 } },
			'strong',
			'source'
		);
		expect(r).toBeNull();
	});
});

describe('a selection overlapping same-format runs applies over the union', () => {
	it('absorbs contained runs instead of nesting a pair around them', () => {
		const raw = '**a** x **b**';
		const r = toggleFormat({ display: raw, content: whole(raw), selection: whole(raw) }, 'strong');
		expect(r.newDisplay).toBe('**a x b**');
		expect(r.newDisplay.slice(r.newSelStart, r.newSelEnd)).toBe('**a x b**');
	});

	it('extends a run the selection only partly covers', () => {
		const raw = '**text text2** plain';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 7, end: 18 } },
			'strong'
		);
		expect(r.newDisplay).toBe('**text text2 pla**in');
	});

	it('merges with a run the selection abuts', () => {
		const raw = '**a**more';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 5, end: 9 } },
			'strong'
		);
		expect(r.newDisplay).toBe('**amore**');
	});

	it('absorbs a run at the head of a wider selection', () => {
		const raw = '**a** tail';
		const r = toggleFormat({ display: raw, content: whole(raw), selection: whole(raw) }, 'strong');
		expect(r.newDisplay).toBe('**a tail**');
	});
});
