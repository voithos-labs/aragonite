// @vitest-environment jsdom
//
// Click → construct: the pointer's raw offset through the shared walk, then the construct chain
// filtered to the kind whose destination is hidden. A blocked-scheme link resolves like any other
// — the card is how a user fixes a blocked URL.
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import type { CstNode } from '$lib/core/nodes';
import { createTextRender, type TextRenderDeps } from '$lib/components/blocks/text/text-render';
import {
	LINK_ELEMENT_SELECTOR,
	linkConstructAt,
	resolveLinkAtPoint
} from '$lib/components/blocks/text/link-at-point';
import type { LinkReferenceResolverRef } from '$lib/editor-keys';

function mount(source: string): {
	el: HTMLElement;
	node: CstNode;
	linkRef: LinkReferenceResolverRef;
} {
	const doc = parse(source);
	const node = doc.children[0];
	const map = buildLinkReferenceMap(doc.children);
	const linkRef: LinkReferenceResolverRef = { current: map.resolve, signature: map.signature };
	const el = document.createElement('div');
	document.body.appendChild(el);
	createTextRender({
		get el() {
			return el;
		},
		get node() {
			return node;
		},
		get ambientPrefix() {
			return '';
		},
		get ambientPrefixText() {
			return '';
		},
		getDisplayText: () => node.raw,
		resolveImageUrl: (u: string) => u,
		resolveLinkUrl: (u: string) => u,
		get imageLoadPolicy() {
			return 'auto' as const;
		},
		get presentationMode() {
			return 'live' as const;
		},
		get linkResolver() {
			return map.resolve;
		},
		get linkStamp() {
			return '1';
		},
		get islands() {
			return [];
		},
		getDocument: () => undefined,
		brokenUrlCache: new Set<string>()
	} as unknown as TextRenderDeps).render();
	return { el, node, linkRef };
}

/** A real caret seat inside the rendered link, the way a click leaves one. */
function clickInside(el: HTMLElement, word: string): Element {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let n: Node | null;
	while ((n = walker.nextNode())) {
		const i = n.textContent?.indexOf(word) ?? -1;
		if (i < 0) continue;
		const range = document.createRange();
		range.setStart(n, i + 1);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
		return n.parentElement!;
	}
	throw new Error(`clickInside: "${word}" not found`);
}

function resolve(source: string, word: string) {
	const { el, node, linkRef } = mount(source);
	const hit = clickInside(el, word).closest(LINK_ELEMENT_SELECTOR);
	return hit === null
		? null
		: resolveLinkAtPoint({ contentEl: el, block: node, path: [0], linkRef });
}

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe('resolveLinkAtPoint', () => {
	it('resolves an inline link to its path and construct start', () => {
		expect(resolve('Visit [example](https://x.com) now\n', 'example')).toMatchObject({
			target: { path: [0], sourceStart: 6 },
			link: { kind: 'link', url: 'https://x.com' }
		});
	});

	it('resolves a blocked-scheme link, which renders as a span rather than an anchor', () => {
		const { el } = mount('Click [x](javascript:alert(1)) now\n');
		expect(el.querySelector('span.md-link-blocked')).not.toBeNull();
		expect(resolve('Click [x](javascript:alert(1)) now\n', 'x')).toMatchObject({
			target: { sourceStart: 6 }
		});
	});

	it('resolves a reference link through the instance resolver, as the render path drew it', () => {
		expect(resolve('See [docs][ref] here\n\n[ref]: https://x.com/d\n', 'docs')).toMatchObject({
			target: { sourceStart: 4 },
			link: { kind: 'link', label: 'ref', url: 'https://x.com/d' }
		});
	});

	it('an autolink is not a card target: its destination is the text the reader already sees', () => {
		const { el } = mount('See <https://x.com> too\n');
		expect(el.querySelector('a.md-autolink')).not.toBeNull();
		expect(clickInside(el, 'https').closest(LINK_ELEMENT_SELECTOR)).toBeNull();
	});

	it('plain text outside every link is not a hit at all', () => {
		expect(resolve('Visit [example](https://x.com) now\n', 'now')).toBeNull();
	});

	it('resolves the INNERMOST link when one nests inside another construct', () => {
		expect(resolve('a **b [inner](u) c** d\n', 'inner')).toMatchObject({
			target: { sourceStart: 6 },
			link: { kind: 'link', url: 'u' }
		});
	});
});

describe('linkConstructAt — the identity an open card re-resolves through', () => {
	it('finds the construct again by its start offset', () => {
		const { node, linkRef } = mount('Visit [example](https://x.com) now\n');
		expect(linkConstructAt(node, 6, linkRef)).toMatchObject({ kind: 'link', end: 30 });
	});

	it('finds one nested inside another construct', () => {
		const { node, linkRef } = mount('a **b [inner](u) c** d\n');
		expect(linkConstructAt(node, 6, linkRef)).toMatchObject({ kind: 'link', url: 'u' });
	});

	it('answers null once the construct at that offset is gone', () => {
		const { node, linkRef } = mount('Visit [example](https://x.com) now\n');
		expect(linkConstructAt(node, 7, linkRef)).toBeNull();
	});
});
