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

	// A 200 response the decoder cannot size — an empty or truncated body, an SVG with
	// no intrinsic dimensions — fires `load`, not `error`, with naturalWidth 0. That is
	// the same state the BUILD-TIME probe already calls broken, so the event-time arm
	// has to agree: while it only ever CLEARED the class, such an image stayed 0×0 with
	// no placeholder until an unrelated rebuild ran the build-time probe against the
	// now-cached failure — the placeholder arriving one render behind the failure.
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
