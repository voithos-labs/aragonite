// @vitest-environment jsdom
//
// A destructive key at a mid-cell `<br>` edge. The `<br>` is the one widget a cell paints with
// no reveal source, so routing it to the cell's step-over hops the caret across on press #1 and
// deletes a NON-adjacent byte on press #2. A cell paints no widget-selection overlay, so the
// affordance it does have is the one-press atomic delete — and each arm has its navigation twin,
// because arrows must keep the step-over.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { mountCell } from './mount-cell';

// `<br>` at raw [4,8) with text on both sides, so both its edges are mid-cell — at a
// cell's text boundaries the navigation plan owns the key and never reaches here.
const CELL = 'Left<br>Right';
const BR_START = 4;
const BR_END = 8;

function press(el: HTMLElement, key: string): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await tick();
}

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('a destructive key at a mid-cell `<br>` edge deletes it whole, in one press', () => {
	const arms: Array<[string, string, number]> = [
		['Backspace at the trailing edge', 'Backspace', BR_END],
		['Delete at the leading edge', 'Delete', BR_START]
	];

	for (const [name, key, caret] of arms) {
		it(`${name} removes the widget's bytes`, async () => {
			mounted = mountCell(CELL);
			const { el, blockEdit, instance } = mounted;
			el.focus();
			instance.setSelection(caret, caret);

			press(el, key);
			await settle();

			expect(vi.mocked(blockEdit.updateBlockContent).mock.calls).toHaveLength(1);
			const [index, text, , caretAfter] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
			expect(index).toBe(0);
			expect(text).toBe('LeftRight');
			expect(caretAfter).toBe(BR_START);
		});

		it(`${name} — the arrow twin steps over it instead, writing nothing`, async () => {
			mounted = mountCell(CELL);
			const { el, blockEdit, instance } = mounted;
			el.focus();
			instance.setSelection(caret, caret);

			press(el, key === 'Backspace' ? 'ArrowLeft' : 'ArrowRight');
			await settle();

			expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
			// The caret crossed the widget rather than resting against it.
			expect(instance.getCursorOffset()).toBe(key === 'Backspace' ? BR_START : BR_END);
		});
	}

	// The NON-entry half of the matrix: a destructive key pointing AWAY from the widget takes the
	// ordinary adjacent character. It rests on `widgetAtCursor`'s direction tie-break.
	const nonEntry: Array<[string, string, number, string]> = [
		['Backspace at the LEADING edge', 'Backspace', BR_START, 'Lef<br>Right'],
		['Delete at the TRAILING edge', 'Delete', BR_END, 'Left<br>ight']
	];

	for (const [name, key, caret, after] of nonEntry) {
		it(`${name} takes the adjacent character, not the tag`, async () => {
			mounted = mountCell(CELL);
			const { el, blockEdit, instance } = mounted;
			el.focus();
			instance.setSelection(caret, caret);

			press(el, key);
			await settle();

			// jsdom leaves this key to native contenteditable, so an absent commit means "not
			// claimed"; e2e/tests/blocks/table/cell-inline-rendering.spec.ts owns the browser outcome.
			const calls = vi.mocked(blockEdit.updateBlockContent).mock.calls;
			if (calls.length > 0) expect(calls[0][1]).toBe(after);
			// Either way the tag survives: nothing wrote a text without it.
			for (const call of calls) expect(call[1]).toContain('<br>');
		});
	}

	// The scoping arm: a cell renders an image as its literal source, not a widget, so the atomic
	// policy must not reach it — the CST classifier calls an image a widget on kind alone.
	it('leaves an image alone — a cell renders its source, not a widget', async () => {
		const withImage = 'Left![a](b)Right';
		mounted = mountCell(withImage);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(withImage.indexOf(')') + 1, withImage.indexOf(')') + 1);

		press(el, 'Backspace');
		await settle();

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});
