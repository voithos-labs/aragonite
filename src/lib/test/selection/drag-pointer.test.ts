// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installDragListener } from '../../selection/drag-pointer';
import { createSelectionState } from '../../selection/selection-state.svelte';

/**
 * Regression: pre-fix, if the editor unmounted mid-drag, pointerup never
 * reached the listener and the document-level handlers (+ their captured
 * references) lived past the editor's lifetime. The fix wires an
 * AbortSignal from the editor's mount lifetime into installDragListener
 * so abort triggers dispose.
 */
describe('installDragListener — lifetime cleanup', () => {
	let editorRoot: HTMLElement;

	beforeEach(() => {
		editorRoot = document.createElement('div');
		document.body.appendChild(editorRoot);
	});

	afterEach(() => {
		editorRoot.remove();
	});

	function makeCtx(signal?: AbortSignal) {
		return {
			editorRoot,
			scrollContainer: editorRoot,
			selection: createSelectionState(),
			getBlockElByPath: () => null,
			lifetimeSignal: signal
		};
	}

	it('without a signal: listeners attach and remain until pointerup / dispose', () => {
		const before = countDocListeners();
		const handle = installDragListener(makeCtx(), { path: [0], offset: 0 });
		expect(countDocListeners()).toBeGreaterThan(before);
		handle.dispose();
		expect(countDocListeners()).toBe(before);
	});

	it('with a lifetime signal: abort disposes listeners without pointerup', () => {
		const controller = new AbortController();
		const before = countDocListeners();
		installDragListener(makeCtx(controller.signal), { path: [0], offset: 0 });
		expect(countDocListeners()).toBeGreaterThan(before);

		controller.abort();

		expect(countDocListeners()).toBe(before);
	});

	it('with a pre-aborted signal: does not attach listeners', () => {
		const controller = new AbortController();
		controller.abort();
		const before = countDocListeners();
		installDragListener(makeCtx(controller.signal), { path: [0], offset: 0 });
		expect(countDocListeners()).toBe(before);
	});

	it('dispose after abort is idempotent', () => {
		const controller = new AbortController();
		const handle = installDragListener(makeCtx(controller.signal), { path: [0], offset: 0 });
		controller.abort();
		expect(() => handle.dispose()).not.toThrow();
	});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * jsdom doesn't expose a listener count. Track by spying on add/remove pairs
 * via a proxy that re-uses the real implementation but tallies the delta.
 */
let currentCount = 0;
const origAdd = document.addEventListener.bind(document);
const origRemove = document.removeEventListener.bind(document);
document.addEventListener = ((type: string, ...rest: unknown[]) => {
	if (type === 'pointermove' || type === 'pointerup') currentCount++;
	return origAdd(type, ...(rest as [EventListenerOrEventListenerObject]));
}) as typeof document.addEventListener;
document.removeEventListener = ((type: string, ...rest: unknown[]) => {
	if (type === 'pointermove' || type === 'pointerup') currentCount--;
	return origRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
}) as typeof document.removeEventListener;

function countDocListeners(): number {
	return currentCount;
}
