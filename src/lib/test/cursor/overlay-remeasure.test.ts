// @vitest-environment jsdom
// Miss-analysis: no test covered the overlay's repaint-on-change bullet, and no unit drove the
// re-measure triggers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlockComponent } from '#lib/block-component.js';
import { wireOverlayRemeasure } from '#lib/cursor/overlay-remeasure.js';

let resizeCallback: ResizeObserverCallback | null = null;

class FakeResizeObserver {
	constructor(callback: ResizeObserverCallback) {
		resizeCallback = callback;
	}
	observe() {}
	disconnect() {
		resizeCallback = null;
	}
}

beforeEach(() => {
	resizeCallback = null;
	vi.stubGlobal('ResizeObserver', FakeResizeObserver);
	vi.stubGlobal('requestAnimationFrame', (run: () => void) => (run(), 1));
	vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

function mountParts() {
	const editorRoot = document.createElement('div');
	const el = document.createElement('div');
	editorRoot.appendChild(el);
	document.body.appendChild(editorRoot);
	return { editorRoot, el };
}

function wire(parts: ReturnType<typeof mountParts>, blockRef?: BlockComponent) {
	const measure = vi.fn();
	const dispose = wireOverlayRemeasure({ ...parts, blockRef, measure });
	return { measure, dispose };
}

describe('wireOverlayRemeasure', () => {
	it('measures once on wiring, reading the table row window first', () => {
		const mountedRowWindow = vi.fn();

		const { measure } = wire(mountParts(), { mountedRowWindow } as unknown as BlockComponent);

		expect(measure).toHaveBeenCalledTimes(1);
		expect(mountedRowWindow).toHaveBeenCalledTimes(1);
	});

	it('measures again when the editor root scrolls', () => {
		const parts = mountParts();
		const { measure } = wire(parts);

		parts.editorRoot.dispatchEvent(new Event('scroll'));

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when the block’s own scroll container scrolls', () => {
		const parts = mountParts();
		const inner = document.createElement('div');
		inner.style.overflowY = 'auto';
		parts.el.appendChild(inner);
		const { measure } = wire(parts);

		inner.dispatchEvent(new Event('scroll'));

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when the block’s box resizes', () => {
		const { measure } = wire(mountParts());

		resizeCallback!([], {} as ResizeObserver);

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('stops measuring once disposed', () => {
		const parts = mountParts();
		const { measure, dispose } = wire(parts);

		dispose();
		parts.editorRoot.dispatchEvent(new Event('scroll'));

		expect(measure).toHaveBeenCalledTimes(1);
		expect(resizeCallback).toBeNull();
	});
});
