import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/components/blocks/text/format-toggle';

// The collapsed-caret contract (docs/changelog.md 0.9.36): insert the empty pair and land the
// caret between its halves, unless it already sits inside such a span or between the halves.

describe('toggleInlineFormat at a collapsed caret', () => {
	it('inserts the empty pair and lands the caret between the halves', () => {
		const r = toggleInlineFormat('hello world', { start: 5, end: 5 }, 'strong');
		expect(r.newDisplay).toBe('hello**** world');
		expect(r.newSelStart).toBe(7);
		expect(r.newSelEnd).toBe(7);
	});

	it('inserts a single-marker pair for emphasis', () => {
		const r = toggleInlineFormat('hello', { start: 5, end: 5 }, 'emphasis');
		expect(r.newDisplay).toBe('hello**');
		expect(r.newSelStart).toBe(6);
	});

	it('inserts at line start and line end', () => {
		expect(toggleInlineFormat('word', { start: 0, end: 0 }, 'strong').newDisplay).toBe('****word');
		expect(toggleInlineFormat('word', { start: 4, end: 4 }, 'strong').newDisplay).toBe('word****');
	});

	it('removes the empty pair on a second press, restoring the caret', () => {
		const first = toggleInlineFormat('ab', { start: 1, end: 1 }, 'strong');
		const second = toggleInlineFormat(
			first.newDisplay,
			{ start: first.newSelStart, end: first.newSelStart },
			'strong'
		);
		expect(second.newDisplay).toBe('ab');
		expect(second.newSelStart).toBe(1);
	});

	it('unwraps the span the caret sits inside rather than nesting a pair', () => {
		const r = toggleInlineFormat('a **bold** b', { start: 6, end: 6 }, 'strong');
		expect(r.newDisplay).toBe('a bold b');
		expect(r.newSelStart).toBe(4);
		expect(r.newSelEnd).toBe(4);
	});

	it('unwraps from the span content edges too', () => {
		expect(toggleInlineFormat('**bold**', { start: 2, end: 2 }, 'strong').newDisplay).toBe('bold');
		expect(toggleInlineFormat('**bold**', { start: 6, end: 6 }, 'strong').newDisplay).toBe('bold');
	});

	it('unwraps the innermost matching layer of a nested construct', () => {
		const r = toggleInlineFormat('***x***', { start: 3, end: 3 }, 'strong');
		expect(r.newDisplay).toBe('*x*');
	});

	it('nests when the caret is inside a span of the other format', () => {
		const r = toggleInlineFormat('**bold**', { start: 4, end: 4 }, 'emphasis');
		expect(r.newDisplay).toBe('**bo**ld**');
		expect(r.newSelStart).toBe(5);
	});

	it('inserts rather than unwrapping when the caret is outside the span', () => {
		const r = toggleInlineFormat('**bold**', { start: 0, end: 0 }, 'strong');
		expect(r.newDisplay).toBe('******bold**');
		expect(r.newSelStart).toBe(2);
	});
});
