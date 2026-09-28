// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCaretRestore, type CaretRestoreDeps } from '$lib/selection/caret-restore';

// What a caret survives when a menu or overlay input takes focus, and what happens when a
// commit rebuilt the DOM under it meanwhile.

let root: HTMLElement;
let leaf: HTMLElement;
let chromeInput: HTMLInputElement;
/** The blocks the restore asked to bring into view. */
let revealed: (readonly number[])[];
let deps: CaretRestoreDeps;

beforeEach(() => {
	document.body.replaceChildren();
	root = document.createElement('div');
	root.tabIndex = -1;
	const host = document.createElement('div');
	host.setAttribute('data-block-path', '[3]');
	leaf = document.createElement('div');
	leaf.setAttribute('contenteditable', 'true');
	leaf.textContent = 'hello world';
	host.append(leaf);
	root.append(host);
	chromeInput = document.createElement('input');
	document.body.append(root, chromeInput);
	revealed = [];
	deps = { getEditorEl: () => root, bringIntoView: (path) => revealed.push(path) };
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
		const restore = createCaretRestore(deps);
		seatCaret(4);
		restore.saveCurrent();
		chromeInput.focus();

		restore.restore();

		expect(document.activeElement).toBe(leaf);
		const selection = window.getSelection()!;
		expect(selection.focusNode).toBe(leaf.firstChild);
		expect(selection.focusOffset).toBe(4);
	});

	// Miss-analysis: the return leaned on the focus call's own scroll, and no test asked who
	// brought the caret's block back into view.
	it('asks for the caret’s block to be brought into view, and focuses without scrolling', () => {
		const restore = createCaretRestore(deps);
		const focus = vi.spyOn(leaf, 'focus');
		seatCaret(4);
		restore.saveCurrent();
		chromeInput.focus();

		restore.restore();

		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(revealed).toEqual([[3]]);
	});

	it('falls back to the editor root for a range outside it, never placing a foreign caret', () => {
		const restore = createCaretRestore(deps);
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
		const restore = createCaretRestore(deps);
		chromeInput.focus();

		restore.restore();

		expect(document.activeElement).toBe(root);
	});

	it('clears the slot, so a second restore cannot re-caret position a stale range', () => {
		const restore = createCaretRestore(deps);
		seatCaret(4);
		restore.saveCurrent();
		restore.restore();
		chromeInput.focus();

		restore.restore();

		expect(document.activeElement).toBe(root);
	});
});
