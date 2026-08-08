import { describe, it, expect } from 'vitest';
import { toggleInlineFormat, markersFor } from '$lib/components/blocks/text/format-toggle';
import { parseInline } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';

const leafText = (nodes: InlineNode[]): string =>
	nodes.map((n) => (n.children ? leafText(n.children) : (n.text ?? ''))).join('');

const whole = (raw: string) => ({ start: 0, end: raw.length });

const FORMATS: InlineMarkKind[] = ['strong', 'emphasis', 'strikethrough', 'inlineCode'];

// Wrap-then-strip is the contract every format owes, whatever its delimiter run: the three fixed
// pairs and inline code's content-sized fence go round the same way.
describe.each(FORMATS)('toggleInlineFormat over a selection (%s)', (format) => {
	const markers = markersFor(format);

	it('wraps a bare selection and selects it, markers included', () => {
		const raw = 'hello world';
		const r = toggleInlineFormat(raw, whole(raw), { start: 6, end: 11 }, format);
		expect(r.newDisplay).toBe(`hello ${markers}world${markers}`);
		expect(r.newDisplay.slice(r.newSelStart, r.newSelEnd)).toBe(`${markers}world${markers}`);
	});

	it('strips the pair back off when the selection includes it', () => {
		const raw = `x ${markers}word${markers} y`;
		const r = toggleInlineFormat(raw, whole(raw), { start: 2, end: raw.length - 2 }, format);
		expect(r.newDisplay).toBe('x word y');
	});

	it('strips the flanking pair when the selection covers only the content', () => {
		const raw = `${markers}word${markers}`;
		const at = markers.length;
		const r = toggleInlineFormat(raw, whole(raw), { start: at, end: at + 4 }, format);
		expect(r.newDisplay).toBe('word');
		expect(r.newSelStart).toBe(0);
		expect(r.newSelEnd).toBe(4);
	});
});

describe('toggleInlineFormat', () => {
	it('does not strip flanking markers when only one side is present', () => {
		const r = toggleInlineFormat('**word', whole('**word'), { start: 2, end: 6 }, 'strong');
		expect(r.newDisplay).toBe('****word**');
		expect(r.newSelStart).toBe(2);
		expect(r.newSelEnd).toBe(10);
	});

	it('does not orphan markers on a multi-span selection (regression)', () => {
		const raw = '**a** **b**';
		const r = toggleInlineFormat(raw, whole(raw), { start: 0, end: 11 }, 'strong');
		// the old strip-the-outer-pair path produced the orphaned `a** **b`
		expect(r.newDisplay).not.toBe('a** **b');
		const parsed = parseInline(r.newDisplay, 0, r.newDisplay.length);
		expect(leafText(parsed)).toBe('a b');
	});

	// The flanking single `*` inside `**word**` belong to a STRONG construct, so toggling emphasis
	// must nest, not strip: the old flank check was construct-blind and destroyed the bold.
	it('nests emphasis inside a strong construct instead of stripping its markers', () => {
		const raw = '**word**';
		const r = toggleInlineFormat(raw, whole(raw), { start: 2, end: 6 }, 'emphasis');
		expect(r.newDisplay).toBe('***word***');
		// The wrap branch selects the freshly wrapped span including its new markers.
		expect(r.newSelStart).toBe(2);
		expect(r.newSelEnd).toBe(8);
	});

	it('nests strong inside an emphasis construct (single-marker flank is not strong)', () => {
		const raw = '*word*';
		const r = toggleInlineFormat(raw, whole(raw), { start: 1, end: 5 }, 'strong');
		expect(r.newDisplay).toBe('***word***');
	});

	it('strips the emphasis layer when the selection is genuinely inside one', () => {
		const raw = '***word***';
		const r = toggleInlineFormat(raw, whole(raw), { start: 3, end: 7 }, 'emphasis');
		expect(r.newDisplay).toBe('**word**');
	});

	it('strips the strong layer of a nested pair from the same selection', () => {
		const raw = '***word***';
		const r = toggleInlineFormat(raw, whole(raw), { start: 3, end: 7 }, 'strong');
		expect(r.newDisplay).toBe('*word*');
	});

	it('nests strikethrough around a strong construct', () => {
		const raw = 'a **b** c';
		const r = toggleInlineFormat(raw, whole(raw), { start: 2, end: 7 }, 'strikethrough');
		expect(r.newDisplay).toBe('a ~~**b**~~ c');
	});
});
