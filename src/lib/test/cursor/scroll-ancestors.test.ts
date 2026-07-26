// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	clippingAncestors,
	firstScrollableDescendant,
	nearestScrollContainer,
	nearestUserScrollableAncestor
} from '../../cursor/scroll-ancestors';

describe('nearestScrollContainer', () => {
	let root: HTMLDivElement;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
	});

	afterEach(() => {
		root.remove();
	});

	function makeChain(styles: Array<Partial<CSSStyleDeclaration>>): HTMLElement {
		let parent: HTMLElement = root;
		let leaf: HTMLElement = root;
		for (const style of styles) {
			const el = document.createElement('div');
			Object.assign(el.style, style);
			parent.appendChild(el);
			parent = el;
			leaf = el;
		}
		return leaf;
	}

	it('returns null when no ancestor is scrollable', () => {
		const leaf = makeChain([{}, {}, {}]);
		expect(nearestScrollContainer(leaf, root)).toBeNull();
	});

	it('returns the nearest ancestor with overflow-x: auto', () => {
		const mid = makeChain([{}, { overflowX: 'auto' }, {}]);
		const expected = mid.parentElement!;
		expect(nearestScrollContainer(mid, root)).toBe(expected);
	});

	it('returns the nearest ancestor with overflow-y: scroll', () => {
		const mid = makeChain([{}, { overflowY: 'scroll' }, {}]);
		const expected = mid.parentElement!;
		expect(nearestScrollContainer(mid, root)).toBe(expected);
	});

	it('treats overflow: hidden as scrollable (clipping context)', () => {
		// jsdom doesn't expand the `overflow` shorthand into the longhand
		// properties that getComputedStyle reports — set both axes explicitly.
		const mid = makeChain([{}, { overflowX: 'hidden', overflowY: 'hidden' }, {}]);
		const expected = mid.parentElement!;
		expect(nearestScrollContainer(mid, root)).toBe(expected);
	});

	it('stops the walk at the root, even if root itself is scrollable', () => {
		root.style.overflowX = 'auto';
		const leaf = makeChain([{}]);
		expect(nearestScrollContainer(leaf, root)).toBeNull();
	});

	it('picks the first scrollable ancestor, not a deeper one', () => {
		const leaf = makeChain([
			{ overflowX: 'auto', overflowY: 'auto' },
			{ overflowX: 'auto', overflowY: 'auto' }
		]);
		const expected = leaf.parentElement!;
		expect(nearestScrollContainer(leaf, root)).toBe(expected);
	});

	it('returns null when el has no parents up to root', () => {
		expect(nearestScrollContainer(root, root)).toBeNull();
	});
});

// The two host-seam walks. Their divergence is the point: one host shape (a
// rounded card, `overflow: hidden` at auto height, inside a real scroller) must
// autoscroll the scroller while bounding visibility by both boxes.
describe('host-seam walks', () => {
	let root: HTMLDivElement;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
	});

	afterEach(() => {
		root.remove();
	});

	function nest(styles: Array<Partial<CSSStyleDeclaration>>): HTMLElement {
		let leaf: HTMLElement = root;
		for (const style of styles) {
			const el = document.createElement('div');
			Object.assign(el.style, style);
			leaf.appendChild(el);
			leaf = el;
		}
		return leaf;
	}

	const card = { overflowX: 'hidden', overflowY: 'hidden' };

	it('answers nothing when the page viewport is what scrolls and bounds', () => {
		const leaf = nest([{}, {}]);
		expect(nearestUserScrollableAncestor(leaf)).toBeNull();
		expect(clippingAncestors(leaf)).toEqual([]);
	});

	it('autoscroll skips a hidden card and finds the real scroller behind it', () => {
		const leaf = nest([{ overflowY: 'auto' }, card, {}]);
		const cardEl = leaf.parentElement!;
		expect(nearestUserScrollableAncestor(leaf)).toBe(cardEl.parentElement);
	});

	it('visibility collects the card AND the scroller, innermost first', () => {
		const leaf = nest([{ overflowY: 'auto' }, card, {}]);
		const cardEl = leaf.parentElement!;
		expect(clippingAncestors(leaf)).toEqual([cardEl, cardEl.parentElement]);
	});

	// A clip box can never be an autoscroll answer — nothing it hid can be scrolled
	// back — but it is the tightest visual bound.
	it('a clipping pane bounds visibility and is never an autoscroll target', () => {
		const leaf = nest([{ overflowX: 'clip', overflowY: 'clip' }, {}]);
		const pane = leaf.parentElement!;
		expect(clippingAncestors(leaf)).toEqual([pane]);
		expect(nearestUserScrollableAncestor(leaf)).toBeNull();
		expect(nearestScrollContainer(leaf, root)).toBeNull(); // the inner walk ignores clip
	});

	// `html`/`body` scrolling IS the window viewport, which the callers already
	// intersect — neither box is that rect.
	it('neither walk returns body or the document element', () => {
		document.body.style.overflowY = 'auto';
		try {
			const leaf = nest([{}]);
			expect(nearestUserScrollableAncestor(leaf)).toBeNull();
			expect(clippingAncestors(leaf)).toEqual([]);
		} finally {
			document.body.style.overflowY = '';
		}
	});
});

describe('firstScrollableDescendant', () => {
	let root: HTMLDivElement;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
	});

	afterEach(() => {
		root.remove();
	});

	it('returns null when no descendant is scrollable', () => {
		root.innerHTML = '<div><div></div></div>';
		expect(firstScrollableDescendant(root)).toBeNull();
	});

	it('returns the first scrollable descendant in document order', () => {
		// root > nonScrollable > scrollableDescendant > leaf
		const a = document.createElement('div');
		const b = document.createElement('div');
		b.style.overflowX = 'auto';
		const c = document.createElement('div');
		root.appendChild(a);
		a.appendChild(b);
		b.appendChild(c);
		expect(firstScrollableDescendant(root)).toBe(b);
	});

	it('does not consider self', () => {
		root.style.overflowX = 'auto';
		expect(firstScrollableDescendant(root)).toBeNull();
	});

	it('prefers shallower scrollable over deeper', () => {
		const shallow = document.createElement('div');
		shallow.style.overflowY = 'scroll';
		const deeperParent = document.createElement('div');
		const deeper = document.createElement('div');
		deeper.style.overflowX = 'auto';
		root.appendChild(shallow);
		root.appendChild(deeperParent);
		deeperParent.appendChild(deeper);
		expect(firstScrollableDescendant(root)).toBe(shallow);
	});
});
