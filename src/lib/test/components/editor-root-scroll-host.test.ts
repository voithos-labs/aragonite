// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createScrollHostResolution } from '$lib/components/editor-root-scroll-host';

// Miss-analysis: scroll-host resolution was tested only by e2e, never its caching or self mode.

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
	it('self mode: the root is the host and nothing clips', () => {
		const { root } = mountUnderScroller();
		const r = createScrollHostResolution({
			get editorEl() {
				return root;
			},
			hostScroll: false
		});
		expect(r.getScrollHost()).toBe(root);
		expect(r.getClipBounds()).toEqual([]);
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
		const mounted = mountUnderScroller();
		mount.root = mounted.root;
		expect(r.getScrollHost()).toBe(mounted.scroller);
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
