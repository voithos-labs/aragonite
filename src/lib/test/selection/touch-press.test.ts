// @vitest-environment jsdom
// On a touch screen a moved finger scrolls and a long press selects natively, so a touch press
// opens no editor drag, and a range it lands on stays until the press turns out to be a tap.
// Miss-analysis: no test exercised touch at all, because nothing read `pointerType`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installDragListener } from '#lib/selection/drag-pointer.js';
import { createCrossBlockPointer } from '#lib/selection/cross-block/pointer.js';
import type { CrossBlockDispatchContext } from '#lib/selection/cross-block/dispatch.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { parse } from '#lib/core/parser.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

const SOURCE = 'first\n\nsecond\n\nthird\n';
const BOXES = [
	{ left: 0, right: 100, top: 0, bottom: 20 },
	{ left: 0, right: 100, top: 30, bottom: 50 },
	{ left: 0, right: 100, top: 60, bottom: 80 }
];
const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 3 } };

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
});

afterEach(() => {
	document.elementFromPoint = origFromPoint;
	globalThis.requestAnimationFrame = origRaf;
	globalThis.cancelAnimationFrame = origCancel;
	editorRoot.remove();
});

describe('a press dragged into the next block', () => {
	function drag(pointerType: string): void {
		installDragListener(
			{
				caretWriter: testCaretWriter,
				editorRoot,
				scrollContainer: wideScrollport(),
				selection,
				getBlockElByPath: () => null
			},
			{ path: [0], offset: 0 },
			press('pointerdown', pointerType)
		);
	}

	it('opens a range from a mouse', () => {
		drag('mouse');
		move(10, 40);
		frame.run();
		expect(selection.isCrossBlock).toBe(true);
	});

	it('opens a range from a pen, which selects text the way a mouse does', () => {
		drag('pen');
		move(10, 40);
		frame.run();
		expect(selection.isCrossBlock).toBe(true);
	});

	it('opens no range from a finger, whose move is a scroll', () => {
		drag('touch');
		move(10, 40);
		frame.run();
		expect(selection.isCrossBlock).toBe(false);
	});

	// The emulator's swipe: a move or two inside one frame, then the browser takes the scroll.
	it('opens no range from a finger whose move is still pending at the cancel', () => {
		drag('touch');
		move(10, 40);
		document.dispatchEvent(press('pointercancel', 'touch'));
		expect(selection.isCrossBlock).toBe(false);
	});
});

describe('a press on a block while a range spans blocks', () => {
	function pressBlock(pointerType: string, lifetime = new AbortController().signal): void {
		const el = editorRoot.children[0] as HTMLElement;
		const pointer = createCrossBlockPointer({
			getEl: () => el,
			getMyPath: () => [0],
			selection,
			caretWriter: testCaretWriter,
			caretMemory: { forget: () => {} },
			standInCaret: () => null,
			getEditorRoot: () => editorRoot,
			getEditorLifetime: () => lifetime,
			getScrollHost: () => null,
			getBlockElByPath: () => null
		} as unknown as CrossBlockDispatchContext);
		pointer.handlePointerDown(press('pointerdown', pointerType));
	}

	beforeEach(() => selection.enterCrossBlock(RANGE.anchor, RANGE.focus));

	it('clears the range at a mouse press', () => {
		pressBlock('mouse');
		expect(selection.isCrossBlock).toBe(false);
	});

	it('keeps the range through a finger press the browser turns into a scroll', () => {
		pressBlock('touch');
		expect(selection.isCrossBlock).toBe(true);
		document.dispatchEvent(press('pointercancel', 'touch'));
		expect(selection.isCrossBlock).toBe(true);
	});

	it('clears the range once a finger press ends as a tap', () => {
		pressBlock('touch');
		document.dispatchEvent(press('pointerup', 'touch'));
		expect(selection.isCrossBlock).toBe(false);
	});

	// An editor that unmounts mid-press must not reset a selection state nobody holds any more.
	it('lets the press go when the editor unmounts before the finger lifts', () => {
		const lifetime = new AbortController();
		pressBlock('touch', lifetime.signal);
		lifetime.abort();
		document.dispatchEvent(press('pointerup', 'touch'));
		expect(selection.isCrossBlock).toBe(true);
	});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// jsdom has no PointerEvent constructor, so the fields the editor reads are defined on a MouseEvent.
function press(type: string, pointerType: string): PointerEvent {
	const e = new MouseEvent(type, { clientX: 10, clientY: 10, button: 0, bubbles: true });
	Object.defineProperties(e, {
		pointerId: { value: 1 },
		pointerType: { value: pointerType },
		isPrimary: { value: true }
	});
	return e as unknown as PointerEvent;
}

function move(clientX: number, clientY: number): void {
	const e = new MouseEvent('pointermove', { clientX, clientY });
	Object.defineProperty(e, 'pointerId', { value: 1 });
	document.dispatchEvent(e);
}

function wideScrollport(): HTMLElement {
	const el = document.createElement('div');
	el.getBoundingClientRect = () =>
		({ left: -1000, top: -1000, right: 2000, bottom: 2000 }) as DOMRect;
	return el;
}

/** One pending callback at a time, mirroring the session's single pending frame. */
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
