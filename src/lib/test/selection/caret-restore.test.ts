// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createCaretRestore } from '$lib/selection/caret-restore';

// The closure search opened and the link card reuses: what a caret survives when chrome takes
// focus, and what happens when the commit that ran meanwhile rebuilt the DOM under it.

let root: HTMLElement;
let leaf: HTMLElement;
let chromeInput: HTMLInputElement;

beforeEach(() => {
	document.body.replaceChildren();
	root = document.createElement('div');
	root.tabIndex = -1;
	leaf = document.createElement('div');
	leaf.setAttribute('contenteditable', 'true');
	leaf.textContent = 'hello world';
	root.append(leaf);
	chromeInput = document.createElement('input');
	document.body.append(root, chromeInput);
});

function seatCaret(offset: number): void {
	const range = document.createRange();
	range.setStart(leaf.firstChild!, offset);
	range.collapse(true);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
}

describe('caret restore', () => {
	it('puts the caret back in its leaf after chrome took focus', () => {
		const restore = createCaretRestore(() => root);
		seatCaret(4);
		restore.saveCurrent();
		chromeInput.focus();

		restore.restore();

		expect(document.activeElement).toBe(leaf);
		const selection = window.getSelection()!;
		expect(selection.focusNode).toBe(leaf.firstChild);
		expect(selection.focusOffset).toBe(4);
	});

	it('falls back to the editor root for a range outside it, never seating a foreign caret', () => {
		const restore = createCaretRestore(() => root);
		const foreign = document.createElement('div');
		foreign.textContent = 'elsewhere';
		document.body.append(foreign);
		const range = document.createRange();
		range.setStart(foreign.firstChild!, 2);
		restore.save(range);

		restore.restore();

		expect(document.activeElement).toBe(root);
	});

	it('falls back to the root when nothing was saved at all', () => {
		const restore = createCaretRestore(() => root);
		chromeInput.focus();

		restore.restore();

		expect(document.activeElement).toBe(root);
	});

	it('clears the slot, so a second restore cannot re-seat a stale range', () => {
		const restore = createCaretRestore(() => root);
		seatCaret(4);
		restore.saveCurrent();
		restore.restore();
		chromeInput.focus();

		restore.restore();

		expect(document.activeElement).toBe(root);
	});
});
