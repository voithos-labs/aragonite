// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createScrollHostResolution } from '$lib/components/editor-root-scroll-host';

// Miss-analysis: host-mode resolution was pinned only by e2e over a real scroller, so nothing
// named the caching (a scroller swapped after the first read is not seen) or the self-mode
// answers.

beforeEach(() => {
	document.body.replaceChildren();
});

function mountUnderScroller() {
	const scroller = document.createElement('div');
	scroller.style.overflowY = 'auto';
	const root = document.createElement('div');
	scroller.append(root);
	document.body.append(scroller);
	return { scroller, root };
}

describe('editor-root scroll host', () => {
	it('self mode: the root is the host, nothing clips, and one scrollport is created', () => {
		const { root } = mountUnderScroller();
		const r = createScrollHostResolution({
			get editorEl() {
				return root;
			},
			hostScroll: false
		});
		expect(r.getScrollHost()).toBe(root);
		expect(r.getClipBounds()).toEqual([]);
		expect(r.getScrollport()).toBe(r.getScrollport());
	});

	it('answers null before the root mounts, then resolves once it has', () => {
		const mount: { root?: HTMLElement } = {};
		const r = createScrollHostResolution({
			get editorEl() {
				return mount.root;
			},
			hostScroll: true
		});
		expect(r.getScrollHost()).toBeNull();
		expect(r.getScrollport()).toBeNull();
		const mounted = mountUnderScroller();
		mount.root = mounted.root;
		expect(r.getScrollHost()).toBe(mounted.scroller);
		expect(r.getScrollport()).not.toBeNull();
	});

	it('host mode: the nearest scrollable ancestor is the host and the clip bound', () => {
		const { scroller, root } = mountUnderScroller();
		const r = createScrollHostResolution({
			get editorEl() {
				return root;
			},
			hostScroll: true
		});
		expect(r.getScrollHost()).toBe(scroller);
		expect(r.getClipBounds()).toEqual([scroller]);
	});

	it('host mode memoizes: a scroller swapped after the first read is not seen', () => {
		const { scroller, root } = mountUnderScroller();
		const r = createScrollHostResolution({
			get editorEl() {
				return root;
			},
			hostScroll: true
		});
		expect(r.getScrollHost()).toBe(scroller);
		const other = mountUnderScroller().scroller;
		other.append(root);
		expect(r.getScrollHost()).toBe(scroller);
		expect(r.getClipBounds()).toEqual([scroller]);
	});
});
