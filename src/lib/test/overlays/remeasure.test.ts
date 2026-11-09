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
	// The resize watch starts on the next frame; run it at once so the box can report.
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

/** The editor's `measureSoon`, held until the test drains it. */
function queue() {
	const runs: Array<() => void> = [];
	return {
		measureSoon: (run: () => void) => void runs.push(run),
		drain: () => runs.splice(0).forEach((run) => run())
	};
}

function wire(parts: ReturnType<typeof mountParts>, blockRef?: BlockComponent) {
	const measure = vi.fn();
	const textMoves = createTextMoves();
	const { measureSoon, drain } = queue();
	const dispose = wireOverlayRemeasure({ ...parts, blockRef, measure, measureSoon, textMoves });
	return { measure, dispose, drain, textMoves };
}

describe('wireOverlayRemeasure', () => {
	it('reads the table row window at once, and queues the first measure', () => {
		const mountedRowWindow = vi.fn();

		const { measure, drain } = wire(mountParts(), {
			mountedRowWindow
		} as unknown as BlockComponent);

		expect(mountedRowWindow).toHaveBeenCalledTimes(1);
		expect(measure).not.toHaveBeenCalled();
		drain();
		expect(measure).toHaveBeenCalledTimes(1);
	});

	it('measures after the next tick without the editor to queue on', async () => {
		const measure = vi.fn();
		wireOverlayRemeasure({ ...mountParts(), blockRef: undefined, measure });

		expect(measure).not.toHaveBeenCalled();
		await tick();
		expect(measure).toHaveBeenCalledTimes(1);
	});

	it('measures again when the editor root scrolls', () => {
		const parts = mountParts();
		const { measure, drain } = wire(parts);
		drain();

		parts.editorRoot.dispatchEvent(new Event('scroll'));

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when the block’s own scroll container scrolls', () => {
		const parts = mountParts();
		const inner = document.createElement('div');
		inner.style.overflowY = 'auto';
		parts.el.appendChild(inner);
		const { measure, drain } = wire(parts);
		drain();

		inner.dispatchEvent(new Event('scroll'));

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when the block’s box resizes', () => {
		const { measure, drain } = wire(mountParts());
		drain();

		resizeCallback!([], {} as ResizeObserver);

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures again when text inside the block moves without a resize', async () => {
		const parts = mountParts();
		const { measure, drain, textMoves } = wire(parts);
		drain();

		textMoves.movedWithin(parts.el);
		await tick();

		expect(measure).toHaveBeenCalledTimes(2);
	});

	it('measures nothing once disposed, the queued first measure included', async () => {
		const parts = mountParts();
		const { measure, dispose, drain, textMoves } = wire(parts);

		dispose();
		drain();
		parts.editorRoot.dispatchEvent(new Event('scroll'));
		textMoves.movedEverywhere();
		await tick();

		expect(measure).not.toHaveBeenCalled();
		expect(resizeCallback).toBeNull();
	});
});
