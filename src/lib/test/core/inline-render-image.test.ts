/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { renderInlineNodes, type RenderInlineOptions } from '$lib/core/inline-render';
import { buildImageWidget } from '$lib/components/image/widget-dom';

// The component layer injects buildImageWidget; core owns no image-widget code
// and renders alt-only without it. The component supplies a per-editor broken-URL
// cache via a closure; mirror that here with one fresh Set per options object.
const withWidget = (opts: RenderInlineOptions = {}): RenderInlineOptions => {
	const brokenUrlCache = new Set<string>();
	return {
		buildImageWidget: (node, raw, imgOpts) =>
			buildImageWidget(node, raw, { ...imgOpts, brokenUrlCache }),
		...opts
	};
};

describe('inline-render image — render-context flag (parameter threading)', () => {
	const raw = '![cat|400](https://example.com/cat.png)';

	it('alt-only path preserves textContent === raw', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, { renderImagesAsWidgets: false });
		expect(frag.textContent).toBe(raw);
	});

	it('without an injected buildImageWidget, images render alt-only even with widgets enabled', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw); // renderImagesAsWidgets defaults true; no builder
		expect(frag.querySelector('[data-image-widget]')).toBeNull();
		expect(frag.textContent).toBe(raw);
	});

	it('with buildImageWidget injected, renders widget without contributing to textContent', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget());
		expect(frag.querySelector('[data-image-widget]')).not.toBeNull();
		expect(frag.textContent).toBe('');
	});

	it('produces widget DOM with renderImagesAsWidgets=true and by default', () => {
		const nodes = parseInline(raw, 0, raw.length);
		for (const opts of [withWidget({ renderImagesAsWidgets: true }), withWidget()]) {
			const frag = renderInlineNodes(nodes, raw, opts);
			expect(frag.querySelector('[data-image-widget]')).not.toBeNull();
			expect(frag.querySelector('img')).not.toBeNull();
		}
	});

	it('widget DOM contains <img> with src after resolver', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(
			nodes,
			raw,
			withWidget({ resolveImageUrl: () => 'https://cdn.example.com/resolved.png' })
		);
		const img = frag.querySelector('img');
		expect(img?.getAttribute('src')).toBe('https://cdn.example.com/resolved.png');
	});

	it('falls back to raw URL when resolveImageUrl throws', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const nodes = parseInline(raw, 0, raw.length);
			const frag = renderInlineNodes(
				nodes,
				raw,
				withWidget({
					resolveImageUrl: () => {
						throw new Error('boom');
					}
				})
			);
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
			const frag = renderInlineNodes(
				nodes,
				raw,
				withWidget({ resolveImageUrl: (() => undefined) as unknown as (u: string) => string })
			);
			const img = frag.querySelector('img');
			expect(img?.getAttribute('src')).toBe('https://example.com/cat.png');
		} finally {
			warn.mockRestore();
		}
	});

	it('widget DOM applies width when |W is present, leaves height unset', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget());
		const img = frag.querySelector('img');
		expect(img?.getAttribute('width')).toBe('400');
		expect(img?.getAttribute('height')).toBeNull();
	});

	it('widget DOM applies width and height for |WxH', () => {
		const rawWH = '![cat|400x300](https://example.com/cat.png)';
		const nodes = parseInline(rawWH, 0, rawWH.length);
		const frag = renderInlineNodes(nodes, rawWH, withWidget());
		const img = frag.querySelector('img');
		expect(img?.getAttribute('width')).toBe('400');
		expect(img?.getAttribute('height')).toBe('300');
	});

	it('widget DOM uses contenteditable=false on the shell', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget());
		const widget = frag.querySelector('[data-image-widget]');
		expect(widget?.getAttribute('contenteditable')).toBe('false');
	});

	it('widget data attributes carry the source-byte raw range', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget());
		const widget = frag.querySelector('[data-image-widget]') as HTMLElement;
		expect(widget.dataset.sourceStart).toBe('0');
		expect(widget.dataset.sourceEnd).toBe(String(raw.length));
	});

	it('widget mode contributes no textContent — bytes live on data attributes', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget());
		expect(frag.textContent).toBe('');
	});

	it('error event on <img> adds md-image-broken to the widget', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget());
		const widget = frag.querySelector('[data-image-widget]') as HTMLElement;
		const img = widget.querySelector('img') as HTMLImageElement;
		img.dispatchEvent(new Event('error'));
		expect(widget.classList.contains('md-image-broken')).toBe(true);
	});

	it('blocks a javascript: image src (no src set, widget marked blocked)', () => {
		const raw = '![x](javascript:alert(1))';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw, withWidget());
		const img = frag.querySelector('img');
		expect(img?.getAttribute('src')).toBeNull();
		expect(frag.querySelector('.md-image-blocked')).not.toBeNull();
	});

	it('allows a data:image src', () => {
		const raw = '![x](data:image/png;base64,AAAA)';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw, withWidget());
		expect(frag.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
	});

	// Tauri hands a webview an `asset://` URL for a local file everywhere except
	// Windows, where the same protocol arrives as `http://asset.localhost/…`.
	it('allows an asset: src a resolver hands back', () => {
		const raw = '![x](assets/a.png)';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(
			inline,
			raw,
			withWidget({ resolveImageUrl: (u) => `asset://localhost/vault/${u}` })
		);
		expect(frag.querySelector('img')?.getAttribute('src')).toBe(
			'asset://localhost/vault/assets/a.png'
		);
		expect(frag.querySelector('.md-image-blocked')).toBeNull();
	});

	it('imageLoadPolicy "placeholder" defers loading (no src, placeholder class)', () => {
		const raw = '![x](https://example.com/a.png)';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw, withWidget({ imageLoadPolicy: 'placeholder' }));
		const img = frag.querySelector('img');
		expect(img?.getAttribute('src')).toBeNull();
		expect(frag.querySelector('.md-image-placeholder')).not.toBeNull();
	});
});
