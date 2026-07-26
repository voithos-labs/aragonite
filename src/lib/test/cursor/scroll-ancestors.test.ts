// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	firstScrollableDescendant,
	nearestScrollContainer,
	nearestScrollHost
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

describe('nearestScrollHost', () => {
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

	it('returns null when the page viewport is what bounds the element', () => {
		expect(nearestScrollHost(nest([{}, {}]))).toBeNull();
	});

	it('returns the nearest scrolling ancestor', () => {
		const leaf = nest([{ overflowY: 'auto' }, {}]);
		expect(nearestScrollHost(leaf)).toBe(leaf.parentElement);
	});

	// The divergence from `nearestScrollContainer`: a clip box cannot scroll, but it
	// bounds what is visible, so a reveal past its edge is unreachable and must be
	// measured against it.
	it('counts a clipping ancestor, which nearestScrollContainer does not', () => {
		const leaf = nest([{ overflowX: 'clip', overflowY: 'clip' }, {}]);
		const pane = leaf.parentElement!;
		expect(nearestScrollHost(leaf)).toBe(pane);
		expect(nearestScrollContainer(leaf, root)).toBeNull();
	});

	it('picks the innermost bounding ancestor when several nest', () => {
		const leaf = nest([{ overflowY: 'auto' }, { overflowX: 'clip', overflowY: 'clip' }, {}]);
		expect(nearestScrollHost(leaf)).toBe(leaf.parentElement);
	});

	// `html`/`body` scrolling IS the window viewport, whose rect the null answers for.
	it('never returns body or the document element', () => {
		document.body.style.overflowY = 'auto';
		try {
			expect(nearestScrollHost(nest([{}]))).toBeNull();
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
