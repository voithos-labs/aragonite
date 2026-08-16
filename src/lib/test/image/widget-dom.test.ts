/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { buildImageWidget } from '$lib/components/image/widget-dom';
import type { InlineNode } from '$lib/core/nodes';

const raw = '![cat](https://example.com/cat.png)';

function imageNode(): InlineNode {
	const node = parseInline(raw, 0, raw.length).find((n) => n.kind === 'image');
	if (!node) throw new Error('expected an image node');
	return node;
}

function build(node: InlineNode, brokenUrlCache: Set<string>): HTMLElement {
	return buildImageWidget(node, raw, {
		resolveImageUrl: (u) => u,
		imageLoadPolicy: 'auto',
		brokenUrlCache
	});
}

describe('buildImageWidget — broken-URL cache (per-instance isolation)', () => {
	it('a cached broken URL marks the rebuilt widget broken synchronously', () => {
		const cache = new Set<string>();
		const node = imageNode();

		const first = build(node, cache);
		first.querySelector('img')!.dispatchEvent(new Event('error'));
		expect(first.classList.contains('md-image-broken')).toBe(true);

		// Keystroke rebuild: a fresh widget for the same URL inherits broken state
		// from the cache without waiting for the async error event to re-fire.
		const second = build(node, cache);
		expect(second.classList.contains('md-image-broken')).toBe(true);
	});

	// A 200 response the decoder cannot size fires `load`, not `error`, with naturalWidth 0 — the
	// same state the build-time probe already calls broken, so the event-time arm has to agree.
	it('a load that completes with no intrinsic size marks broken, like the build-time probe', () => {
		const cache = new Set<string>();
		const widget = build(imageNode(), cache);

		widget.querySelector('img')!.dispatchEvent(new Event('load'));

		expect(widget.classList.contains('md-image-broken')).toBe(true);
		expect(cache.size).toBe(1);
	});

	it('a load with a real intrinsic size clears a cached failure', () => {
		const cache = new Set<string>();
		const widget = build(imageNode(), cache);
		const img = widget.querySelector('img')!;
		img.dispatchEvent(new Event('error'));

		Object.defineProperty(img, 'naturalWidth', { value: 42, configurable: true });
		img.dispatchEvent(new Event('load'));

		expect(widget.classList.contains('md-image-broken')).toBe(false);
		expect(cache.size).toBe(0);
	});

	it("one cache's failure does not bleed into another's lookup", () => {
		const cacheA = new Set<string>();
		const cacheB = new Set<string>();
		const node = imageNode();

		build(node, cacheA).querySelector('img')!.dispatchEvent(new Event('error'));

		// A second editor instance (its own cache) must start clean for the same URL.
		const other = build(node, cacheB);
		expect(other.classList.contains('md-image-broken')).toBe(false);
		expect(cacheB.size).toBe(0);
	});
});

// Miss (#50): every widget-dom test asserted the widget's own DOM, none the path it emits, and
// no fixture ever put a widget on a surface whose path the block-path walk stops short of.
describe('buildImageWidget — the path a click emits', () => {
	it('names the enclosing cell, not the table block the walk stops at (#50)', () => {
		const host = document.createElement('div');
		host.setAttribute('data-block-path', '[1]');
		host.innerHTML =
			'<div data-table-row-idx="1"><div role="cell"></div><div role="cell"></div></div>';
		const cell = host.querySelectorAll('[role="cell"]')[1] as HTMLElement;
		const widget = build(imageNode(), new Set<string>());
		cell.appendChild(widget);
		document.body.appendChild(host);

		let emitted: number[] | null = null;
		host.addEventListener('image-widget-select', (e) => {
			emitted = ((e as CustomEvent).detail as { paragraphPath: number[] }).paragraphPath;
		});
		widget.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		// Row 1, column 1 of the table at [1]: the cell owns the bytes the widget renders.
		expect(emitted).toEqual([1, 1, 1]);
		host.remove();
	});
});
