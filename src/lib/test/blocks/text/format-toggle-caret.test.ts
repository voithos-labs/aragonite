import { describe, it, expect } from 'vitest';
import { MARK_FORMATS, markersOf, toggleFormat } from './format-toggle-fixture';

// The collapsed-caret contract: insert the empty pair and land the caret between its halves,
// unless it already sits inside such a span or between the halves.

const whole = (raw: string) => ({ start: 0, end: raw.length });

describe.each(MARK_FORMATS)('toggleInlineFormat at a collapsed caret (%s)', (format) => {
	const markers = markersOf(format);
	const at = (raw: string, caret: number) =>
		toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: caret, end: caret } },
			format
		);

	it('inserts the empty pair and lands the caret between the halves', () => {
		const r = at('hello world', 5);
		expect(r.newDisplay).toBe(`hello${markers}${markers} world`);
		expect(r.newSelStart).toBe(5 + markers.length);
		expect(r.newSelEnd).toBe(r.newSelStart);
	});

	it('inserts at line start and line end', () => {
		expect(at('word', 0).newDisplay).toBe(`${markers}${markers}word`);
		expect(at('word', 4).newDisplay).toBe(`word${markers}${markers}`);
	});

	it('removes the empty pair on a second press, restoring the caret', () => {
		const first = at('ab', 1);
		const second = at(first.newDisplay, first.newSelStart);
		expect(second.newDisplay).toBe('ab');
		expect(second.newSelStart).toBe(1);
	});

	it('unwraps the span the caret sits inside rather than nesting a pair', () => {
		const raw = `a ${markers}bold${markers} b`;
		const r = at(raw, 2 + markers.length + 2);
		expect(r.newDisplay).toBe('a bold b');
		expect(r.newSelStart).toBe(4);
	});

	it('unwraps from the span content edges too', () => {
		const raw = `${markers}bold${markers}`;
		expect(at(raw, markers.length).newDisplay).toBe('bold');
		expect(at(raw, markers.length + 4).newDisplay).toBe('bold');
	});
});

describe('toggleInlineFormat at a collapsed caret', () => {
	it('unwraps the innermost matching layer of a nested construct', () => {
		const r = toggleFormat(
			{ display: '***x***', content: whole('***x***'), selection: { start: 3, end: 3 } },
			'strong'
		);
		expect(r.newDisplay).toBe('*x*');
	});

	it('nests when the caret is inside a span of the other format', () => {
		const raw = '**bold**';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 4, end: 4 } },
			'emphasis'
		);
		expect(r.newDisplay).toBe('**bo**ld**');
		expect(r.newSelStart).toBe(5);
	});

	it('inserts rather than unwrapping when the caret is outside the span', () => {
		const raw = '**bold**';
		const r = toggleFormat(
			{ display: raw, content: whole(raw), selection: { start: 0, end: 0 } },
			'strong'
		);
		expect(r.newDisplay).toBe('******bold**');
		expect(r.newSelStart).toBe(2);
	});
});
