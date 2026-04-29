/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
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

	it('produces widget DOM with renderImagesAsWidgets=true and by default', () => {
		const nodes = parseInline(raw, 0, raw.length);
		for (const opts of [{ renderImagesAsWidgets: true }, undefined]) {
			const frag = renderInlineNodes(nodes, raw, opts);
			expect(frag.querySelector('[data-image-widget]')).not.toBeNull();
			expect(frag.querySelector('img')).not.toBeNull();
		}
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

	it('falls back to raw URL when resolveImageUrl throws', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const nodes = parseInline(raw, 0, raw.length);
			const frag = renderInlineNodes(nodes, raw, {
				renderImagesAsWidgets: true,
				resolveImageUrl: () => {
					throw new Error('boom');
				}
			});
			const img = frag.querySelector('img');
			expect(img?.getAttribute('src')).toBe('https://example.com/cat.png');
		} finally {
			warn.mockRestore();
		}
	});

	it('falls back to raw URL when resolveImageUrl returns a non-string', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const nodes = parseInline(raw, 0, raw.length);
			const frag = renderInlineNodes(nodes, raw, {
				renderImagesAsWidgets: true,
				resolveImageUrl: (() => undefined) as unknown as (u: string) => string
			});
			const img = frag.querySelector('img');
			expect(img?.getAttribute('src')).toBe('https://example.com/cat.png');
		} finally {
			warn.mockRestore();
		}
	});

	it('widget DOM applies width when |W is present, leaves height unset', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true });
		const img = frag.querySelector('img');
		expect(img?.getAttribute('width')).toBe('400');
		expect(img?.getAttribute('height')).toBeNull();
	});

	it('widget DOM applies width and height for |WxH', () => {
		const rawWH = '![cat|400x300](https://example.com/cat.png)';
		const nodes = parseInline(rawWH, 0, rawWH.length);
		const frag = renderInlineNodes(nodes, rawWH, { renderImagesAsWidgets: true });
		const img = frag.querySelector('img');
		expect(img?.getAttribute('width')).toBe('400');
		expect(img?.getAttribute('height')).toBe('300');
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

	it('error event on <img> adds md-image-broken to the widget', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: true });
		const widget = frag.querySelector('[data-image-widget]') as HTMLElement;
		const img = widget.querySelector('img') as HTMLImageElement;
		img.dispatchEvent(new Event('error'));
		expect(widget.classList.contains('md-image-broken')).toBe(true);
	});
});
