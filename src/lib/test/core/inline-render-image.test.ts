/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/editor/core/inline';
import { renderInlineNodes } from '$lib/editor/core/inline-render';

describe('inline-render image — render-context flag (parameter threading)', () => {
	const raw = '![cat|400](https://example.com/cat.png)';

	it('accepts the new options object without error', () => {
		const nodes = parseInline(raw, 0, raw.length);
		expect(() => renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true })).not.toThrow();
		expect(() => renderInlineNodes(nodes, raw, { renderImagesAsWidgets: false })).not.toThrow();
		expect(() => renderInlineNodes(nodes, raw)).not.toThrow();
	});

	it('alt-only path preserves textContent === raw', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: false });
		expect(frag.textContent).toBe(raw);
	});

	it('default behavior (no opts) preserves textContent === raw', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw);
		expect(frag.textContent).toBe(raw);
	});
});
