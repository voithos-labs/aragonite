// @vitest-environment jsdom

// Miss-analysis: the e2e fixture relayed only thrown page errors, not ones via `window.onerror`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSharedResizeWatch, observeResize } from '../../windowing/observe-resize';

const observed: Element[] = [];
let disconnects = 0;
let frames: Array<() => void> = [];
let deliver: ResizeObserverCallback = () => {};

class FakeResizeObserver {
	constructor(callback: ResizeObserverCallback) {
		deliver = callback;
	}
	// A real observer watches an element once, however often it is asked to.
	observe(el: Element) {
		if (!observed.includes(el)) observed.push(el);
	}
	unobserve(el: Element) {
		if (observed.includes(el)) observed.splice(observed.indexOf(el), 1);
	}
	disconnect() {
		disconnects++;
	}
}

/** A resize delivery for `el`, while the fake observer still watches it. */
function resize(el: Element): void {
	if (!observed.includes(el)) return;
	deliver([{ target: el } as ResizeObserverEntry], {} as ResizeObserver);
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

// Miss-analysis: the shared watch only ever had one watcher per element (a block list's child), so
// no row put a second one (the drawn caret on a table row's first cell) on the same element.
describe('createSharedResizeWatch', () => {
	it('keeps delivering to one watcher when another watcher of the same element stops', () => {
		const sizes = createSharedResizeWatch();
		const el = document.createElement('div');
		const rowHeights: number[] = [];
		const caretRepaints: number[] = [];
		sizes.watch(el, () => rowHeights.push(1));
		const stopCaret = sizes.watch(el, () => caretRepaints.push(1));
		frames.forEach((run) => run());

		resize(el);
		stopCaret();
		resize(el);

		expect(caretRepaints).toHaveLength(1);
		expect(rowHeights).toHaveLength(2);
	});

	it('stops observing an element once its last watcher stops', () => {
		const sizes = createSharedResizeWatch();
		const el = document.createElement('div');
		const stopFirst = sizes.watch(el, () => {});
		const stopSecond = sizes.watch(el, () => {});
		frames.forEach((run) => run());

		stopFirst();
		expect(observed).toContain(el);
		stopSecond();
		expect(observed).not.toContain(el);
	});
});
