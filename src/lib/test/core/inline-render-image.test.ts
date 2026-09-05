/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { renderInlineNodes, type RenderInlineOptions } from '$lib/core/inline-render';
import type { InlineNode } from '$lib/core/nodes';
import { buildImageWidget } from '$lib/components/image/widget-dom';
import { takeDevWarns } from '../support/warn-gate';

// Core owns no image-widget code; the component injects it along with a per-editor
// broken-URL cache, mirrored here as one fresh Set per options object.
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
		const frag = renderInlineNodes(nodes, raw);
		expect(frag.querySelector('[data-image-widget]')).toBeNull();
		expect(frag.textContent).toBe(raw);
	});

	it('with buildImageWidget injected, renders widget without contributing to textContent', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget());
		expect(frag.querySelector('[data-image-widget]')).not.toBeNull();
		expect(frag.textContent).toBe('');
	});

	it('produces widget DOM with explicit renderImagesAsWidgets=true', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw, withWidget({ renderImagesAsWidgets: true }));
		expect(frag.querySelector('[data-image-widget]')).not.toBeNull();
		expect(frag.querySelector('img')).not.toBeNull();
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
		expect(frag.querySelector('img')?.getAttribute('src')).toBe('https://example.com/cat.png');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['image-widget']);
	});

	it('falls back to raw URL when resolveImageUrl returns a non-string', () => {
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(
			nodes,
			raw,
			withWidget({ resolveImageUrl: (() => undefined) as unknown as (u: string) => string })
		);
		expect(frag.querySelector('img')?.getAttribute('src')).toBe('https://example.com/cat.png');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['image-widget']);
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

// The fallback a kind with `renderImagesAsWidgets: false` (table cells) renders
// through — and any block whose consumer injects no widget builder.
describe('inline-render image — alt-only fallback', () => {
	const renderFallback = (nodes: InlineNode[], raw: string) =>
		renderInlineNodes(nodes, raw, { renderImagesAsWidgets: false });

	// The shape an inline-syntax rung mints for an Obsidian-style embed: an `image`
	// node whose alt names the target, over markers three characters wide.
	const embedNode = (raw: string, target: string): InlineNode => ({
		kind: 'image',
		start: 0,
		end: raw.length,
		children: [],
		alt: target,
		url: target
	});

	it('prints an image whose alt is not a slice of its source as its own bytes', () => {
		const raw = '![[cat.png]]';
		expect(renderFallback([embedNode(raw, 'cat.png')], raw).textContent).toBe(raw);
	});

	it('leaves such an image unmarked, so no presentation mode can hide its bytes', () => {
		const raw = '![[cat.png]]';
		// Markers collapse in reading/preview modes. Claiming bytes as markers when
		// the node can't say which they are would blank the construct outright.
		expect(
			renderFallback([embedNode(raw, 'cat.png')], raw).querySelectorAll('.md-marker')
		).toHaveLength(0);
	});

	// With no alt there is nothing to leave behind when markers collapse, so the whole
	// construct is markers rather than a split placed over bytes nothing can name.
	it('renders an alt-less image as markers alone', () => {
		const gfm = '![](u)';
		const gfmFrag = renderFallback(parseInline(gfm, 0, gfm.length), gfm);
		expect(gfmFrag.textContent).toBe(gfm);
		expect([...gfmFrag.querySelectorAll('.md-marker')].map((m) => m.textContent)).toEqual([
			'![',
			'](u)'
		]);

		const minted = '![[x]]';
		const frag = renderFallback(
			[{ kind: 'image', start: 0, end: minted.length, children: [], url: 'x' }],
			minted
		);
		expect(frag.textContent).toBe(minted);
		expect([...frag.querySelectorAll('.md-marker')].map((m) => m.textContent)).toEqual([
			'![',
			'[x]]'
		]);
	});

	it('keeps a GFM image split into markers around its alt text', () => {
		const raw = '![cat|400](https://example.com/cat.png)';
		const frag = renderFallback(parseInline(raw, 0, raw.length), raw);
		expect([...frag.querySelectorAll('.md-marker')].map((m) => m.textContent)).toEqual([
			'![',
			'|400](https://example.com/cat.png)'
		]);
		expect(frag.textContent).toBe(raw);
	});

	it('keeps the split for a reference-form image, whose alt is read off the label', () => {
		const raw = '![cat][ref]';
		const nodes = parseInline(raw, 0, raw.length, () => ({ url: 'https://example.com/cat.png' }));
		const frag = renderFallback(nodes, raw);
		expect([...frag.querySelectorAll('.md-marker')].map((m) => m.textContent)).toEqual([
			'![',
			'][ref]'
		]);
		expect(frag.textContent).toBe(raw);
	});
});
