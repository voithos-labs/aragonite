/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/editor/core/inline';
import { renderInlineNodes } from '$lib/editor/core/inline-render';

describe('inline-render image — render-context flag (parameter threading)', () => {
	const raw = '![cat|400](https://example.com/cat.png)';

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

	it('with renderImagesAsWidgets=true produces widget DOM', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true });
		expect(frag.querySelector('[data-image-widget]')).not.toBeNull();
		expect(frag.querySelector('img')).not.toBeNull();
	});

	it('default behavior (no opts) produces widget DOM', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw);
		expect(frag.querySelector('[data-image-widget]')).not.toBeNull();
	});

	it('widget DOM contains <img> with src after resolver', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, {
			renderImagesAsWidgets: true,
			resolveImageUrl: (u) => `resolved://${u}`
		});
		const img = frag.querySelector('img');
		expect(img?.getAttribute('src')).toBe('resolved://https://example.com/cat.png');
	});

	it('widget DOM applies width and height when present', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true });
		const img = frag.querySelector('img');
		expect(img?.getAttribute('width')).toBe('400');
	});

	it('widget DOM uses contenteditable=false on the shell', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true });
		const widget = frag.querySelector('[data-image-widget]');
		expect(widget?.getAttribute('contenteditable')).toBe('false');
	});

	it('hidden source span carries the source bytes', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true });
		const sourceSpan = frag.querySelector('.md-image-source');
		expect(sourceSpan?.textContent).toBe(raw);
	});

	it('widget mode preserves textContent === raw (the load-bearing invariant)', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true });
		expect(frag.textContent).toBe(raw);
	});
});
