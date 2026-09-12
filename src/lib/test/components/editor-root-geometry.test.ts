// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	installHeaderSlotCompensation,
	installTypeScaleProbe,
	installViewportHeightWatcher,
	installWidthWatcher
} from '$lib/components/editor-root-geometry';
import { ESTIMATE_BASE_FONT_SIZE } from '$lib/cursor/typography-estimates';

// Observable stand-in for the observer jsdom does not implement.
class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	disconnected = false;
	constructor(private callback: ResizeObserverCallback) {
		FakeResizeObserver.instances.push(this);
	}
	observe(): void {}
	disconnect(): void {
		this.disconnected = true;
	}
	trigger(entries: ResizeObserverEntry[] = []): void {
		this.callback(entries, this as unknown as ResizeObserver);
	}
}

const teardowns: (() => void)[] = [];

beforeEach(() => {
	FakeResizeObserver.instances.length = 0;
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
	delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

const observer = () => FakeResizeObserver.instances[0];

/** An element whose box the test sets by hand, since jsdom lays nothing out. */
function boxed(width: number, height: number) {
	const el = document.createElement('div');
	Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
	Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
	el.getBoundingClientRect = () => ({ width, height }) as DOMRect;
	return { el, setWidth: (w: number) => (width = w), setHeight: (h: number) => (height = h) };
}

const borderBox = (blockSize: number) =>
	[{ borderBoxSize: [{ blockSize, inlineSize: 0 }] }] as unknown as ResizeObserverEntry[];

describe('editor-root geometry — width watcher', () => {
	it('fires on a width change only, and disconnects on teardown', () => {
		const box = boxed(400, 300);
		let changes = 0;
		teardowns.push(installWidthWatcher(box.el, () => changes++));
		box.setHeight(600);
		observer().trigger();
		expect(changes).toBe(0);
		box.setWidth(500);
		observer().trigger();
		expect(changes).toBe(1);
		teardowns.splice(0).forEach((teardown) => teardown());
		expect(observer().disconnected).toBe(true);
	});
});

describe('editor-root geometry — viewport-height watcher', () => {
	it('bumps on a window resize, and stops after teardown', () => {
		let bumps = 0;
		const teardown = installViewportHeightWatcher(window, () => bumps++);
		teardowns.push(teardown);
		window.dispatchEvent(new Event('resize'));
		expect(bumps).toBe(1);
		teardown();
		window.dispatchEvent(new Event('resize'));
		expect(bumps).toBe(1);
	});

	it('an element port bumps on a height change only', () => {
		const box = boxed(400, 100);
		let bumps = 0;
		teardowns.push(installViewportHeightWatcher(box.el, () => bumps++));
		observer().trigger();
		expect(bumps).toBe(0);
		box.setHeight(200);
		observer().trigger();
		expect(bumps).toBe(1);
	});
});

describe('editor-root geometry — type-scale probe', () => {
	function probe(fontSizePx: number, scale: number) {
		const box = boxed(0, fontSizePx);
		const reported: number[] = [];
		teardowns.push(
			installTypeScaleProbe(box.el, { getScale: () => scale, onScale: (s) => reported.push(s) })
		);
		return { reported };
	}

	it('seeds from the probe box at install, relative to the calibration size', () => {
		const p = probe(ESTIMATE_BASE_FONT_SIZE * 1.5, 1);
		expect(p.reported).toEqual([1.5]);
	});

	it('a sub-percent move and an empty box are both ignored', () => {
		const p = probe(ESTIMATE_BASE_FONT_SIZE * 1.005, 1);
		observer().trigger(borderBox(0));
		expect(p.reported).toEqual([]);
	});

	it('a later report reads the border box', () => {
		const p = probe(ESTIMATE_BASE_FONT_SIZE, 1);
		observer().trigger(borderBox(ESTIMATE_BASE_FONT_SIZE * 2));
		expect(p.reported).toEqual([2]);
	});
});

describe('editor-root geometry — header slot compensation', () => {
	function slot(opts: { scrollTop?: number; owns?: boolean; holds?: boolean } = {}) {
		const box = boxed(400, 40);
		let top = opts.scrollTop ?? 120;
		teardowns.push(
			installHeaderSlotCompensation({
				el: box.el,
				port: { scrollTop: () => top, setScrollTop: (v) => (top = v) },
				ownsScrollCorrection: () => opts.owns ?? true,
				revealHoldsScroll: () => opts.holds ?? false
			})
		);
		return { grow: (by: number) => observer().trigger(borderBox(40 + by)), top: () => top };
	}

	it('a growing header shifts the port by the delta, keeping the reader in place', () => {
		const s = slot();
		s.grow(30);
		expect(s.top()).toBe(150);
	});

	it.each([
		['the port sits at the top', { scrollTop: 0 }],
		['the host owns the correction', { owns: false }],
		['a reveal holds the scroll', { holds: true }]
	])('leaves the port alone when %s', (_label, opts) => {
		const s = slot(opts);
		const before = s.top();
		s.grow(30);
		expect(s.top()).toBe(before);
	});
});
