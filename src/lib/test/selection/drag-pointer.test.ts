// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installDragListener } from '../../selection/drag-pointer';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';

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
		const handle = installDragListener(makeCtx(), { path: [0], offset: 0 }, down());
		expect(countDocListeners()).toBeGreaterThan(before);
		handle.dispose();
		expect(countDocListeners()).toBe(before);
	});

	it('with a lifetime signal: abort disposes listeners without pointerup', () => {
		const controller = new AbortController();
		const before = countDocListeners();
		installDragListener(makeCtx(controller.signal), { path: [0], offset: 0 }, down());
		expect(countDocListeners()).toBeGreaterThan(before);

		controller.abort();

		expect(countDocListeners()).toBe(before);
	});

	it('with a pre-aborted signal: does not attach listeners', () => {
		const controller = new AbortController();
		controller.abort();
		const before = countDocListeners();
		installDragListener(makeCtx(controller.signal), { path: [0], offset: 0 }, down());
		expect(countDocListeners()).toBe(before);
	});

	it('dispose after abort is idempotent', () => {
		const controller = new AbortController();
		const handle = installDragListener(
			makeCtx(controller.signal),
			{ path: [0], offset: 0 },
			down()
		);
		controller.abort();
		expect(() => handle.dispose()).not.toThrow();
	});

	// The signal and no-signal teardown paths differ in source, so both arms stay named.
	for (const withSignal of [false, true]) {
		it(`pointercancel disposes listeners just like pointerup (${withSignal ? 'lifetime signal' : 'no signal'})`, () => {
			const signal = withSignal ? new AbortController().signal : undefined;
			const before = countDocListeners();
			installDragListener(makeCtx(signal), { path: [0], offset: 0 }, down());
			expect(countDocListeners()).toBeGreaterThan(before);

			document.dispatchEvent(new Event('pointercancel'));

			expect(countDocListeners()).toBe(before);
		});
	}

	// The shared session filters up/cancel to the pointer that opened the drag, but only
	// table-reorder-drag pinned it; the cross-block, reorder and cell lifecycles carried no test.
	it('a second pointer’s pointerup does not end a drag another pointer started', () => {
		const before = countDocListeners();
		installDragListener(makeCtx(), { path: [0], offset: 0 }, down(1));
		expect(countDocListeners()).toBeGreaterThan(before);

		// A stray second touch releasing must not tear down this drag.
		document.dispatchEvent(pointerEnd('pointerup', 2));
		expect(countDocListeners()).toBeGreaterThan(before);

		// The owning pointer's release tears it down.
		document.dispatchEvent(pointerEnd('pointerup', 1));
		expect(countDocListeners()).toBe(before);
	});
});

// Miss-analysis: the drag suite only ever counted listeners. The park is the drag's one
// coordinate-space consumer and the only sibling of four that never translated a cell endpoint,
// because nothing asserted WHERE it parks — only that the drag tore down cleanly.
describe('installDragListener — where the drag parks its dispatch caret', () => {
	const TABLE_LAST = 'para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
	let editorRoot: HTMLElement;

	beforeEach(() => {
		editorRoot = document.createElement('div');
		document.body.appendChild(editorRoot);
	});

	afterEach(() => editorRoot.remove());

	it('parks in the focus CELL when a drag ends inside a table', () => {
		const doc = parse(TABLE_LAST);
		const selection = createSelectionState({ getDoc: () => doc });
		const requested: number[][] = [];
		// Cell index 3 of a 2-column table is row 1, col 1 — the flagged focus a drag into the
		// last cell leaves (`block-hit-test.ts :: endpointAtPoint`).
		selection.enterCrossBlock(
			{ path: [0], offset: 0 },
			{ path: [1], offset: 3, cellCoordinate: true }
		);
		installDragListener(
			{
				editorRoot,
				scrollContainer: editorRoot,
				selection,
				getBlockElByPath: (path) => {
					requested.push(path);
					return document.createElement('div');
				}
			},
			{ path: [0], offset: 0 },
			down()
		);

		document.dispatchEvent(new MouseEvent('pointerup'));

		expect(requested).toEqual([[1, 1, 1]]);
	});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// jsdom's PointerEvent is unreliable; a MouseEvent with pointerId defined onto it
// carries the ownership id the session filters on (undefined = mouse fallback).
function down(pointerId?: number): PointerEvent {
	const e = new MouseEvent('pointerdown');
	if (pointerId !== undefined) Object.defineProperty(e, 'pointerId', { value: pointerId });
	return e as unknown as PointerEvent;
}

function pointerEnd(type: 'pointerup' | 'pointercancel', pointerId: number): Event {
	const e = new MouseEvent(type);
	Object.defineProperty(e, 'pointerId', { value: pointerId });
	return e;
}

// jsdom doesn't expose a listener count — tally add/remove pairs via a proxy.
let currentCount = 0;
const origAdd = document.addEventListener.bind(document);
const origRemove = document.removeEventListener.bind(document);
document.addEventListener = ((type: string, ...rest: unknown[]) => {
	if (type === 'pointermove' || type === 'pointerup' || type === 'pointercancel') currentCount++;
	return origAdd(type, ...(rest as [EventListenerOrEventListenerObject]));
}) as typeof document.addEventListener;
document.removeEventListener = ((type: string, ...rest: unknown[]) => {
	if (type === 'pointermove' || type === 'pointerup' || type === 'pointercancel') currentCount--;
	return origRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
}) as typeof document.removeEventListener;

function countDocListeners(): number {
	return currentCount;
}
