// @vitest-environment jsdom
//
// From a click to a construct: the click's raw offset through the shared traversal, then the
// construct chain filtered to the kinds whose destination is hidden. A link with a blocked scheme
// resolves like any other, since the card is how a user fixes a blocked URL.
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import type { CstNode } from '$lib/core/nodes';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import {
	LINK_ELEMENT_SELECTOR,
	linkConstructAt,
	resolveLinkAtPoint
} from '$lib/components/blocks/text/link-at-point';
import { makeRenderHarness } from '$lib/test/harness/text-render';
import { fixtureReading } from '../../harness/fixture-grammar';
import type { Reading } from '$lib/schema/reading';

function mount(source: string): {
	el: HTMLElement;
	node: CstNode;
	reading: Reading;
} {
	const doc = parse(source);
	const node = doc.children[0];
	const map = buildLinkReferenceMap(doc.children);
	const reading: Reading = fixtureReading({
		resolver: map.resolve,
		resolverSignature: map.signature
	});
	const harness = makeRenderHarness(node, {
		mode: 'live',
		reading: { resolver: map.resolve, resolverSignature: map.signature, resolverEpoch: 1 }
	});
	createTextRender(harness.deps).render();
	return { el: harness.el, node, reading };
}

/** A real caret inside the rendered link, the way a click leaves one. */
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
	const { el, node, reading } = mount(source);
	const hit = clickInside(el, word).closest(LINK_ELEMENT_SELECTOR);
	return hit === null
		? null
		: resolveLinkAtPoint({ contentEl: el, block: node, path: [0], reading });
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

	it('resolves the innermost link when one nests inside another construct', () => {
		expect(resolve('a **b [inner](u) c** d\n', 'inner')).toMatchObject({
			target: { sourceStart: 6 },
			link: { kind: 'link', url: 'u' }
		});
	});
});

describe('linkConstructAt: the identity an open card re-resolves through', () => {
	it('finds the construct again by its start offset', () => {
		const { node, reading } = mount('Visit [example](https://x.com) now\n');
		expect(linkConstructAt(node, 6, reading)).toMatchObject({ kind: 'link', end: 30 });
	});

	it('finds one nested inside another construct', () => {
		const { node, reading } = mount('a **b [inner](u) c** d\n');
		expect(linkConstructAt(node, 6, reading)).toMatchObject({ kind: 'link', url: 'u' });
	});

	it('answers null once the construct at that offset is gone', () => {
		const { node, reading } = mount('Visit [example](https://x.com) now\n');
		expect(linkConstructAt(node, 7, reading)).toBeNull();
	});
});
