import { describe, it, expect } from 'vitest';
import { toggleInlineFormat } from '$lib/components/blocks/text/format-toggle';
import { parseInline } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';

const leafText = (nodes: InlineNode[]): string =>
	nodes.map((n) => (n.children ? leafText(n.children) : (n.text ?? ''))).join('');

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

	it('does not orphan markers on a multi-span selection (regression)', () => {
		const r = toggleInlineFormat('**a** **b**', { start: 0, end: 11 }, 'strong');
		// the old strip-the-outer-pair path produced the orphaned `a** **b`
		expect(r.newDisplay).not.toBe('a** **b');
		const parsed = parseInline(r.newDisplay, 0, r.newDisplay.length);
		expect(leafText(parsed)).toBe('a b');
	});

	// The flanking single `*` inside `**word**` belong to a STRONG construct, not an
	// emphasis one. Toggling emphasis must nest (add a layer), not strip the inner
	// star of each `**` — the old flank check was construct-blind and produced the
	// bold-destroying `*word*`.
	it('nests emphasis inside a strong construct instead of stripping its markers', () => {
		const r = toggleInlineFormat('**word**', { start: 2, end: 6 }, 'emphasis');
		expect(r.newDisplay).toBe('***word***');
		// The wrap branch selects the freshly wrapped span including its new markers.
		expect(r.newSelStart).toBe(2);
		expect(r.newSelEnd).toBe(8);
	});

	it('nests strong inside an emphasis construct (single-marker flank is not strong)', () => {
		const r = toggleInlineFormat('*word*', { start: 1, end: 5 }, 'strong');
		expect(r.newDisplay).toBe('***word***');
	});

	it('strips the emphasis layer when the selection is genuinely inside one', () => {
		const r = toggleInlineFormat('***word***', { start: 3, end: 7 }, 'emphasis');
		expect(r.newDisplay).toBe('**word**');
	});
});
