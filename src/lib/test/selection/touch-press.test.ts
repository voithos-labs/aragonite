// @vitest-environment jsdom
// On a touch screen a moved finger scrolls and a long press selects natively, so a touch press
// opens no editor drag, a range it lands on stays until the press turns out to be a tap, and the
// browser's long-press range becomes the editor's own once the press ends.
// Miss-analysis: no test exercised touch at all, because nothing read `pointerType`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installDragListener } from '#lib/selection/drag-pointer.js';
import { createCrossBlockPointer } from '#lib/selection/cross-block/pointer.js';
import type { CrossBlockDispatchContext } from '#lib/selection/cross-block/dispatch.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { parse } from '#lib/core/parser.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import { blockContentElAt } from '#lib/caret/block-el-lookup.js';
import { takeDevWarns } from '../support/warn-gate';

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
	function drag(pointerType: string, touch: 'own' | 'browser' = 'browser'): void {
		installDragListener(
			{
				touch,
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
		expect(selection.ownsRange).toBe(true);
	});

	it('opens a range from a pen, which selects text the way a mouse does', () => {
		drag('pen');
		move(10, 40);
		frame.run();
		expect(selection.ownsRange).toBe(true);
	});

	it('opens no range from a finger, whose move is a scroll', () => {
		drag('touch');
		move(10, 40);
		frame.run();
		expect(selection.ownsRange).toBe(false);
	});

	// A selection knob takes the finger (`touch-action: none`), so its drag is the editor's.
	it('opens a range from a finger on a control that owns the touch', () => {
		drag('touch', 'own');
		move(10, 40);
		frame.run();
		expect(selection.ownsRange).toBe(true);
	});

	// The emulator's swipe: a move or two inside one frame, then the browser takes the scroll.
	it('opens no range from a finger whose move is still pending at the cancel', () => {
		drag('touch');
		move(10, 40);
		document.dispatchEvent(press('pointercancel', 'touch'));
		expect(selection.ownsRange).toBe(false);
	});
});

describe('a press on a block while a range spans blocks', () => {
	// The editor's lifetime, ended after each case so no press listener outlives its test.
	let editorLifetime: AbortController;

	function pressBlock(
		pointerType: string,
		lifetime = editorLifetime.signal,
		init: MouseEventInit = {}
	): void {
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
			getBlockElByPath: (path: number[]) => blockContentElAt(editorRoot, path)
		} as unknown as CrossBlockDispatchContext);
		pointer.handlePointerDown(press('pointerdown', pointerType, init));
	}

	beforeEach(() => {
		editorLifetime = new AbortController();
		giveBlocksText();
		selection.enterCrossBlock(RANGE.anchor, RANGE.focus);
	});
	afterEach(() => editorLifetime.abort());

	it('clears the range at a mouse press', () => {
		pressBlock('mouse');
		expect(selection.ownsRange).toBe(false);
	});

	it('keeps the range through a finger press the browser turns into a scroll', () => {
		pressBlock('touch');
		expect(selection.ownsRange).toBe(true);
		document.dispatchEvent(press('pointercancel', 'touch'));
		expect(selection.ownsRange).toBe(true);
	});

	it('clears the range once a finger press ends as a tap', () => {
		pressBlock('touch');
		document.dispatchEvent(press('pointerup', 'touch'));
		expect(selection.ownsRange).toBe(false);
	});

	// A tablet with a keyboard: a Shift press grows the range, and its lift must not clear it.
	it('keeps the range through a finger press with Shift held', () => {
		pressBlock('touch', undefined, { shiftKey: true });
		document.dispatchEvent(press('pointerup', 'touch'));
		expect(selection.ownsRange).toBe(true);
	});

	// Android's long press: selectstart while the finger is held, the word, then a pointercancel.
	// Miss-analysis: the rows only had a press end as a scroll or a tap, never as a selection.
	it("ends the range at the held finger's selection, then takes its word at the pointercancel", () => {
		pressBlock('touch');
		document.dispatchEvent(new Event('selectstart', { bubbles: true }));
		expect(selection.ownsRange).toBe(false);
		selectNative(2, 0, 5);
		document.dispatchEvent(press('pointercancel', 'touch'));
		expectOwnedWord(2, 0, 5);
	});

	// iOS's long press: no selectstart, the word lands while the finger is held, then a pointerup.
	it("ends the range at the held finger's word, then takes the word at the pointerup", () => {
		pressBlock('touch');
		selectNative(2, 0, 5);
		document.dispatchEvent(new Event('selectionchange'));
		expect(selection.ownsRange).toBe(false);
		document.dispatchEvent(press('pointerup', 'touch'));
		expectOwnedWord(2, 0, 5);
	});

	it('adopts the range the browser writes in that block afterwards, until the next press', () => {
		pressBlock('touch');
		selectNative(2, 0, 5);
		document.dispatchEvent(new Event('selectionchange'));
		document.dispatchEvent(press('pointerup', 'touch'));
		// Safari writes its word back just after the press ends; Android's held drag grows it.
		selectNative(2, 0, 3);
		document.dispatchEvent(new Event('selectionchange'));
		expectOwnedWord(2, 0, 3);
		document.dispatchEvent(press('pointerdown', 'mouse'));
		selectNative(2, 1, 4);
		document.dispatchEvent(new Event('selectionchange'));
		expect(selection.end).toEqual({ path: [2], offset: 3 });
	});

	// G1.169: a range the takeover can't adopt beside the editor's is the one a phone would draw on.
	it('leaves a range in another block than the taken one, and the dev check names it', () => {
		pressBlock('touch');
		selectNative(2, 0, 5);
		document.dispatchEvent(new Event('selectionchange'));
		document.dispatchEvent(press('pointerup', 'touch'));
		selectNative(1, 0, 3);
		document.dispatchEvent(new Event('selectionchange'));
		expect([selection.start, selection.end]).toEqual([
			{ path: [2], offset: 0 },
			{ path: [2], offset: 5 }
		]);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:finger-range-leaves-caret']);
	});

	it('takes nothing when the held finger left no range', () => {
		pressBlock('touch');
		document.dispatchEvent(new Event('selectstart', { bubbles: true }));
		document.getSelection()!.removeAllRanges();
		document.dispatchEvent(press('pointercancel', 'touch'));
		expect(selection.ownsRange).toBe(false);
	});

	// An editor that unmounts mid-press must not reset a selection state nobody holds any more.
	it('lets the press go when the editor unmounts before the finger lifts', () => {
		const lifetime = new AbortController();
		pressBlock('touch', lifetime.signal);
		lifetime.abort();
		document.dispatchEvent(press('pointerup', 'touch'));
		expect(selection.ownsRange).toBe(true);
	});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// jsdom has no PointerEvent constructor, so the fields the editor reads are defined on a MouseEvent.
function press(type: string, pointerType: string, init: MouseEventInit = {}): PointerEvent {
	const e = new MouseEvent(type, { clientX: 10, clientY: 10, button: 0, bubbles: true, ...init });
	Object.defineProperties(e, {
		pointerId: { value: 1 },
		pointerType: { value: pointerType },
		isPrimary: { value: true }
	});
	return e as unknown as PointerEvent;
}

// Each block's text in an editable, where the browser's long-press range lands.
function giveBlocksText(): void {
	[...editorRoot.children].forEach((block, index) => {
		const text = document.createElement('div');
		text.setAttribute('contenteditable', 'true');
		text.textContent = SOURCE.split('\n\n')[index].trim();
		block.appendChild(text);
	});
}

// A native range the browser writes inside block `index`'s text.
function selectNative(index: number, from: number, to: number): void {
	const text = blockContentElAt(editorRoot, [index])!.firstChild!;
	document.getSelection()!.setBaseAndExtent(text, from, text, to);
}

// The editor holds the word as its own painted range, with only a caret left in the DOM.
function expectOwnedWord(index: number, from: number, to: number): void {
	expect([selection.isCustomRendered, selection.start, selection.end]).toEqual([
		true,
		{ path: [index], offset: from },
		{ path: [index], offset: to }
	]);
	expect(document.getSelection()!.isCollapsed).toBe(true);
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
