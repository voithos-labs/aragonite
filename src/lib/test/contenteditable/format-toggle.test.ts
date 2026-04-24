import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/editor/components/blocks/text/format-toggle';

describe('toggleInlineFormat', () => {
	it('wraps a bare selection with the marker pair', () => {
		const r = toggleInlineFormat('hello world', { start: 6, end: 11 }, 'strong');
		expect(r.newDisplay).toBe('hello **world**');
		expect(r.newSelStart).toBe(6);
		expect(r.newSelEnd).toBe(15);
	});

	it('strips markers when selection includes them', () => {
		const r = toggleInlineFormat('**bold**', { start: 0, end: 8 }, 'strong');
		expect(r.newDisplay).toBe('bold');
		expect(r.newSelStart).toBe(0);
		expect(r.newSelEnd).toBe(4);
	});

	it('strips flanking markers when selection excludes them (double-click case)', () => {
		const r = toggleInlineFormat('**word**', { start: 2, end: 6 }, 'strong');
		expect(r.newDisplay).toBe('word');
		expect(r.newSelStart).toBe(0);
		expect(r.newSelEnd).toBe(4);
	});

	it('handles emphasis (single-asterisk) flanking detection', () => {
		const r = toggleInlineFormat('*word*', { start: 1, end: 5 }, 'emphasis');
		expect(r.newDisplay).toBe('word');
		expect(r.newSelStart).toBe(0);
		expect(r.newSelEnd).toBe(4);
	});

	it('does not strip flanking markers when only one side is present', () => {
		const r = toggleInlineFormat('**word', { start: 2, end: 6 }, 'strong');
		expect(r.newDisplay).toBe('****word**');
		expect(r.newSelStart).toBe(2);
		expect(r.newSelEnd).toBe(10);
	});
});
