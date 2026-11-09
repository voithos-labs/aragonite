// @vitest-environment jsdom
// Miss-analysis: no test covered the overlay's repaint-on-change bullet, and no unit drove the
// re-measure triggers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlockComponent } from '#lib/block-component.js';
import { wireOverlayRemeasure } from '#lib/components/overlays/remeasure.js';
import { createTextMoves } from '#lib/components/overlays/text-moves.js';
import { tick } from 'svelte';

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
	it('reads the table row window at once, and measures on the next frame', () => {
		const mountedRowWindow = vi.fn();
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));

		const { measure } = wire(mountParts(), { mountedRowWindow } as unknown as BlockComponent);

		expect(mountedRowWindow).toHaveBeenCalledTimes(1);
		expect(measure).not.toHaveBeenCalled();
		frames.forEach((run) => run(0));
		expect(measure).toHaveBeenCalledTimes(1);
	});

	it('measures before returning when asked to, for an element focus is about to enter', () => {
		const measure = vi.fn();
		wireOverlayRemeasure({ ...mountParts(), blockRef: undefined, measure, measureNow: true });

		expect(measure).toHaveBeenCalledTimes(1);
	});

	it('measures again when the editor root scrolls', async () => {
		const parts = mountParts();
		const { measure } = wire(parts);
		await tick();

		parts.editorRoot.dispatchEvent(new Event('scroll'));

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when the block’s own scroll container scrolls', async () => {
		const parts = mountParts();
		const inner = document.createElement('div');
		inner.style.overflowY = 'auto';
		parts.el.appendChild(inner);
		const { measure } = wire(parts);
		await tick();

		inner.dispatchEvent(new Event('scroll'));

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when the block’s box resizes', async () => {
		const { measure } = wire(mountParts());
		await tick();

		resizeCallback!([], {} as ResizeObserver);

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when text inside the block moves without a resize', async () => {
		const parts = mountParts();
		const textMoves = createTextMoves();
		const measure = vi.fn();
		wireOverlayRemeasure({ ...parts, blockRef: undefined, measure, textMoves });

		textMoves.movedWithin(parts.el);
		await tick();

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('stops measuring once disposed', async () => {
		const parts = mountParts();
		const textMoves = createTextMoves();
		const measure = vi.fn();
		const dispose = wireOverlayRemeasure({ ...parts, blockRef: undefined, measure, textMoves });

		dispose();
		parts.editorRoot.dispatchEvent(new Event('scroll'));
		textMoves.movedEverywhere();
		await tick();

		// The stubbed frame ran the setup measure at once; nothing after the dispose measured.
		expect(measure).toHaveBeenCalledTimes(1);
		expect(resizeCallback).toBeNull();
	});
});
