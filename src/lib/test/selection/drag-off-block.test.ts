// @vitest-environment jsdom
//
// A drag whose pointer leaves every block: the frame coalescer keeps only the latest position, so
// a burst ending in the margin is the whole frame's move. Miss-analysis: the drag suite counted
// listeners and asserted where the release parks, never drove a MOVE through it, so the branch
// deciding whether a gesture opens a range at all had no test at any layer — and the Chromium e2e
// lane paces one move per frame, the one shape that never reproduces it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installDragListener } from '$lib/selection/drag-pointer';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { parse } from '$lib/core/parser';

const SOURCE = 'first\n\nsecond\n\nthird\n';
const BOXES = [
	{ left: 0, right: 100, top: 0, bottom: 20 },
	{ left: 0, right: 100, top: 20, bottom: 40 },
	{ left: 0, right: 100, top: 40, bottom: 60 }
];
// The focus below the anchor snaps to its block's end, so each arm's offset is that block's length.
const END_OF = { second: 6, third: 5 };

describe('a drag that ends off every block', () => {
	let editorRoot: HTMLElement;
	let selection: ReturnType<typeof createSelectionState>;
	let frame: { run(): void };
	const origFromPoint = document.elementFromPoint;
	const origRaf = globalThis.requestAnimationFrame;
	const origCancel = globalThis.cancelAnimationFrame;

	beforeEach(() => {
		editorRoot = document.createElement('div');
		document.body.appendChild(editorRoot);
		BOXES.forEach((box, index) => {
			const block = document.createElement('div');
			block.setAttribute('data-block-path', JSON.stringify([index]));
			block.getBoundingClientRect = () => box as DOMRect;
			editorRoot.appendChild(block);
		});
		document.elementFromPoint = ((x: number, y: number) => {
			const index = BOXES.findIndex(
				(b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
			);
			return index === -1 ? null : editorRoot.children[index];
		}) as typeof document.elementFromPoint;

		const doc = parse(SOURCE);
		selection = createSelectionState({ getDoc: () => doc });
		frame = stubFrame();
		installDragListener(
			{
				editorRoot,
				// Far larger than every point below, so no edge band arms the autoscroll loop and
				// the stubbed frame stays the drag's own.
				scrollContainer: wideScrollport(),
				selection,
				getBlockElByPath: () => null
			},
			{ path: [0], offset: 0 },
			pointerDown()
		);
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		globalThis.requestAnimationFrame = origRaf;
		globalThis.cancelAnimationFrame = origCancel;
		editorRoot.remove();
	});

	it('opens the range from a burst whose last sample is in the margin below', () => {
		move(10, 30);
		move(10, 50);
		move(10, 90);
		frame.run();

		expect(selection.isCrossBlock).toBe(true);
		expect(selection.focus).toEqual({ path: [2], offset: END_OF.third });
	});

	// One move gets the same answer: the burst is what real input coalesces into, not what the
	// clamp is for. A drag autoscrolling in the margin sends nothing but off-block moves.
	it('opens the range from a single move into the margin below', () => {
		move(10, 90);
		frame.run();

		expect(selection.isCrossBlock).toBe(true);
		expect(selection.focus).toEqual({ path: [2], offset: END_OF.third });
	});

	// x off the side, y inside a band: the nearest block is the one the pointer is beside.
	it('extends to the block beside a point in the gutter', () => {
		move(-40, 30);
		frame.run();

		expect(selection.focus).toEqual({ path: [1], offset: END_OF.second });
	});

	// Clamping means an off-block point can now resolve to the ANCHOR block, which is the
	// collapse branch: the overlay stops painting a range the pointer has left.
	it('collapses when the off-block point clamps back to the anchor block', () => {
		move(10, 50);
		frame.run();
		expect(selection.isCrossBlock).toBe(true);

		move(-40, 10);
		frame.run();

		expect(selection.isCrossBlock).toBe(false);
	});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function move(clientX: number, clientY: number): void {
	document.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY }));
}

function pointerDown(): PointerEvent {
	return new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }) as unknown as PointerEvent;
}

function wideScrollport(): HTMLElement {
	const el = document.createElement('div');
	el.getBoundingClientRect = () =>
		({ left: -1000, top: -1000, right: 2000, bottom: 2000 }) as DOMRect;
	return el;
}

/** One armed callback at a time, mirroring the coalescer's single pending frame. */
function stubFrame(): { run(): void } {
	let armed: FrameRequestCallback | null = null;
	globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
		armed = fn;
		return 1;
	}) as typeof requestAnimationFrame;
	globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
	return {
		run() {
			const fn = armed;
			armed = null;
			fn?.(0);
		}
	};
}
