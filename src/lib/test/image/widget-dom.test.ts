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
		paragraphPath: [],
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
