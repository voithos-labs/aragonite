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

let reportedHeight = 0;

/** Lays `el` out at a new size and delivers its report, while the fake observer still watches
 *  it; each is a new height unless the caller names one. */
function resize(el: Element, height = ++reportedHeight, width = 600): void {
	el.getBoundingClientRect = () => ({ width, height }) as DOMRect;
	report(el, { width, height });
}

/** A report for `el` whose border box is `box`, with no change to how `el` is laid out. */
function report(el: Element, box: { width: number; height: number }): void {
	if (!observed.includes(el)) return;
	const borderBoxSize = [{ blockSize: box.height, inlineSize: box.width }];
	deliver([{ target: el, borderBoxSize } as unknown as ResizeObserverEntry], {} as ResizeObserver);
}

/** An element in the document whose laid-out box is whatever `size` holds now. */
function laidOut(size: { width: number; height: number }): HTMLElement {
	const el = document.body.appendChild(document.createElement('div'));
	el.getBoundingClientRect = () => ({ ...size }) as DOMRect;
	return el;
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

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

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

// Miss-analysis (#798): the shared watch had no early report, so a scroll read off the page while
// a report had not come yet worked from tables that lagged the page, and no row covered either half.
describe('createSharedResizeWatch: reporting early', () => {
	it('hands a laid-out change over once, and nothing on a second call with no change', () => {
		const sizes = createSharedResizeWatch();
		const size = { width: 600, height: 20 };
		const heard: number[] = [];
		sizes.watch(laidOut(size), (height) => heard.push(height));
		frames.forEach((run) => run());
		sizes.reportNow();
		size.height = 420;
		sizes.reportNow();
		sizes.reportNow();
		expect(heard).toEqual([20, 420]);
	});

	it("skips the observer's own later report of the size it already handed over", () => {
		const sizes = createSharedResizeWatch();
		const size = { width: 600, height: 420 };
		const el = laidOut(size);
		const heard: number[] = [];
		sizes.watch(el, (height) => heard.push(height));
		frames.forEach((run) => run());
		sizes.reportNow();
		resize(el, 420);
		resize(el, 380);
		expect(heard).toEqual([420, 380]);
	});

	// The drawn caret repaints on a reflow that changes only the width.
	it('still hands over a change in width alone', () => {
		const sizes = createSharedResizeWatch();
		const el = laidOut({ width: 600, height: 420 });
		const heard: number[] = [];
		sizes.watch(el, (height) => heard.push(height));
		frames.forEach((run) => run());
		sizes.reportNow();
		resize(el, 420, 500);
		expect(heard).toEqual([420, 420]);
	});

	// Miss-analysis: every fake report's border box matched the stubbed rect, so the readers never
	// disagreed. An ancestor's `transform: scale()` or `zoom` scales the rect but not the border box.
	it('hears one height per change when the border box and the laid-out box differ', () => {
		const sizes = createSharedResizeWatch();
		const el = laidOut({ width: 480, height: 336 });
		const heard: number[] = [];
		sizes.watch(el, (height) => heard.push(height));
		frames.forEach((run) => run());
		sizes.reportNow();
		report(el, { width: 600, height: 420 });
		sizes.reportNow();
		expect(heard).toEqual([336]);
	});

	it('hands nothing to an element whose last watcher stopped during the same call', () => {
		const sizes = createSharedResizeWatch();
		const first = laidOut({ width: 600, height: 20 });
		const second = laidOut({ width: 600, height: 420 });
		let stopSecond = () => {};
		sizes.watch(first, () => stopSecond());
		stopSecond = sizes.watch(second, () => {});
		sizes.reportNow();
		const heard: number[] = [];
		sizes.watch(second, (height) => heard.push(height));
		sizes.reportNow();
		expect(heard).toEqual([420]);
	});

	it('reads nothing for an element no longer in the document', () => {
		const sizes = createSharedResizeWatch();
		const el = laidOut({ width: 600, height: 420 });
		const heard: number[] = [];
		sizes.watch(el, (height) => heard.push(height));
		el.remove();
		sizes.reportNow();
		expect(heard).toEqual([]);
	});
});
