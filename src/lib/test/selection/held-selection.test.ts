// @vitest-environment jsdom
// Miss-analysis: #820, every selection question asked the browser alone, and no row held a range
// the editor owns, under which the browser's selection is a caret.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	holdsSelection,
	isContextPress,
	rangeHolder,
	selectionCoversPoint
} from '#lib/selection/held-selection.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	delete (Range.prototype as Partial<Range>).getClientRects;
});

/** An editor root holding `text`, and the editor's selection over it. */
function editor(text = 'words') {
	const root = document.createElement('div');
	root.textContent = text;
	document.body.append(root);
	return { root, selection: createSelectionState() };
}

const across = (selection: ReturnType<typeof createSelectionState>) =>
	selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

function selectBrowserRange(root: HTMLElement): void {
	window.getSelection()!.setBaseAndExtent(root.firstChild!, 0, root.firstChild!, 3);
}

function paint(
	root: HTMLElement,
	box: { left: number; right: number; top: number; bottom: number }
) {
	const el = document.createElement('div');
	el.className = 'selection-overlay';
	el.getBoundingClientRect = () => box as DOMRect;
	root.append(el);
}

describe('isContextPress', () => {
	it('is the right button anywhere, and Control with the primary button only on a Mac', () => {
		expect(isContextPress({ button: 2, ctrlKey: false })).toBe(true);
		expect(isContextPress({ button: 0, ctrlKey: true })).toBe(false);
		vi.stubGlobal('navigator', { platform: 'MacIntel' });
		expect(isContextPress({ button: 0, ctrlKey: true })).toBe(true);
		expect(isContextPress({ button: 0, ctrlKey: false })).toBe(false);
	});
});

describe('who holds the selection', () => {
	it('a range the editor owns is held while the browser holds none', () => {
		const { root, selection } = editor();
		across(selection);
		expect(holdsSelection(selection, root)).toBe(true);
		expect(rangeHolder(selection)).toBe('editor');
	});

	it('a widget the editor holds is held for Cut and Copy, though no range is', () => {
		const { root, selection } = editor();
		selection.selectWidget({ paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 });
		expect(holdsSelection(selection, root)).toBe(true);
		expect(rangeHolder(selection)).toBeNull();
	});

	it('the browser holds its own range only inside the root it is asked about', () => {
		const { root, selection } = editor();
		const elsewhere = editor('other').root;
		selectBrowserRange(root);
		expect(holdsSelection(selection, root)).toBe(true);
		expect(holdsSelection(selection, elsewhere)).toBe(false);
		expect(rangeHolder(selection)).toBe('browser');
	});

	it('a caret is no selection', () => {
		const { root, selection } = editor();
		window.getSelection()!.collapse(root.firstChild!, 2);
		expect(holdsSelection(selection, root)).toBe(false);
		expect(rangeHolder(selection)).toBeNull();
	});
});

describe('selectionCoversPoint', () => {
	it('reads a range the editor paints from its paint, not the browser’s highlight', () => {
		const { root, selection } = editor();
		across(selection);
		paint(root, { left: 0, right: 100, top: 0, bottom: 20 });
		expect(selectionCoversPoint(selection, root, 50, 10)).toBe(true);
		expect(selectionCoversPoint(selection, root, 50, 40)).toBe(false);
	});

	it('reads the browser’s range from its own rectangles', () => {
		const { root, selection } = editor();
		selectBrowserRange(root);
		Range.prototype.getClientRects = () => [{ left: 0, right: 30, top: 0, bottom: 20 }] as never;
		expect(selectionCoversPoint(selection, root, 10, 10)).toBe(true);
		expect(selectionCoversPoint(selection, root, 50, 10)).toBe(false);
	});
});
