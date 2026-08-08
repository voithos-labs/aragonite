import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/components/blocks/text/format-toggle';
import { parseInline } from '$lib/core/inline';

// Inline code is the only format whose delimiter run is content-dependent, in BOTH directions: a
// wrap sizes its fence past the longest run it encloses, and a strip reads the run the parsed
// span actually carries. Every case here asserts the bytes reparse as one code span holding the
// intended text — the fence length alone proves nothing.

const whole = (raw: string) => ({ start: 0, end: raw.length });

/** The content of the one code span the bytes must parse as, or null if they parse as anything
 *  else — which is the whole question for a fence the wrap sized itself. */
function soleCodeSpanText(raw: string): string | null {
	const code = parseInline(raw, 0, raw.length).filter((node) => node.kind === 'inlineCode');
	return code.length === 1 ? (code[0].text ?? null) : null;
}

describe('toggleInlineFormat — inline code wrap', () => {
	it('wraps a plain selection in a single backtick', () => {
		const raw = 'call fetchAll now';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 5, end: 13 } },
			'inlineCode'
		);
		expect(r.newDisplay).toBe('call `fetchAll` now');
		expect(soleCodeSpanText(r.newDisplay)).toBe('fetchAll');
	});

	it('sizes the fence past the longest run inside the selection', () => {
		const raw = 'a ``x`` y b';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 2, end: 9 } },
			'inlineCode'
		);
		expect(r.newDisplay).toBe('a ``` ``x`` y ``` b');
		expect(soleCodeSpanText(r.newDisplay)).toBe(' ``x`` y ');
	});

	it('pads a selection that starts or ends with a backtick, so the fence still closes', () => {
		const raw = 'a `b';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 2, end: 4 } },
			'inlineCode'
		);
		expect(soleCodeSpanText(r.newDisplay)).toBe(' `b ');
	});

	it('selects the whole wrapped span, markers included', () => {
		const raw = 'ab';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 0, end: 2 } },
			'inlineCode'
		);
		expect(r.newDisplay.slice(r.newSelStart, r.newSelEnd)).toBe('`ab`');
	});
});

describe('toggleInlineFormat — inline code strip', () => {
	// The pad a backtick-bearing wrap adds is content once written — the render path paints it —
	// so a strip takes the fence runs and nothing else.
	it('strips a multi-backtick fence, leaving the content bytes untouched', () => {
		const raw = 'a ``` ``x`` ``` b';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 2, end: 15 } },
			'inlineCode'
		);
		expect(r.newDisplay).toBe('a  ``x``  b');
	});

	it('strips the flanking run when the selection sits at the span content', () => {
		const raw = 'a ```x``` b';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 5, end: 6 } },
			'inlineCode'
		);
		expect(r.newDisplay).toBe('a x b');
	});

	it('unwraps at a collapsed caret using the span own run length', () => {
		const raw = 'a ``x`y`` b';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 5, end: 5 } },
			'inlineCode'
		);
		expect(r.newDisplay).toBe('a x`y b');
		expect(r.newSelStart).toBe(3);
	});

	it('inserts a one-backtick pair at a caret and removes it on the second press', () => {
		const first = toggleInlineFormat(
			{ display: 'ab', content: whole('ab'), selection: { start: 1, end: 1 } },
			'inlineCode'
		);
		expect(first.newDisplay).toBe('a``b');
		expect(first.newSelStart).toBe(2);
		const second = toggleInlineFormat(
			{
				display: first.newDisplay,
				content: whole(first.newDisplay),
				selection: { start: 2, end: 2 }
			},
			'inlineCode'
		);
		expect(second.newDisplay).toBe('ab');
	});

	it('nests a code span inside a strong construct rather than eating its stars', () => {
		const raw = '**word**';
		const r = toggleInlineFormat(
			{ display: raw, content: whole(raw), selection: { start: 2, end: 6 } },
			'inlineCode'
		);
		expect(r.newDisplay).toBe('**`word`**');
	});
});
