// @vitest-environment jsdom

// Miss-analysis: the e2e fixture relayed only thrown page errors, so the loop error a host
// observed mid-delivery raises through `window.onerror` alone went unseen until it did.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeResize } from '../../cursor/observe-resize';

const observed: Element[] = [];
let disconnects = 0;
let frames: Array<() => void> = [];

class FakeResizeObserver {
	observe(el: Element) {
		observed.push(el);
	}
	disconnect() {
		disconnects++;
	}
}

beforeEach(() => {
	observed.length = 0;
	disconnects = 0;
	frames = [];
	vi.stubGlobal('ResizeObserver', FakeResizeObserver);
	vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
	vi.stubGlobal('cancelAnimationFrame', (id: number) => {
		frames[id - 1] = () => {};
	});
});

afterEach(() => vi.unstubAllGlobals());

describe('observeResize', () => {
	it('starts observing at the next frame, not at the call', () => {
		const el = document.createElement('div');
		observeResize(el, () => {});
		expect(observed).toEqual([]);
		frames.forEach((run) => run());
		expect(observed).toEqual([el]);
	});

	it('never observes an element disposed before its frame', () => {
		const dispose = observeResize(document.createElement('div'), () => {});
		dispose();
		frames.forEach((run) => run());
		expect(observed).toEqual([]);
		expect(disconnects).toBe(1);
	});
});
