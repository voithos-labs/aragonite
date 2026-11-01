// @vitest-environment jsdom
// The handles stand on the browser's own range even while a menu holds focus, where the editor's
// selection, which reads the focused block, is null.
// Miss-analysis: every desktop row set the range with focus in its block; the phone's long-press
// menu takes focus before the browser selects the word.
import { describe, it, expect, afterEach } from 'vitest';
import { handleRange } from '#lib/components/overlays/selection-handles.js';
import { readCurrentSelection } from '#lib/selection/native-bridge.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';

afterEach(() => {
	document.body.innerHTML = '';
	document.getSelection()?.removeAllRanges();
});

describe('handleRange', () => {
	it("reads the browser's range in one block while focus sits on a menu", () => {
		document.body.innerHTML =
			'<div id="root"><div data-block-path="[0]"><p contenteditable="true">alpha beta</p></div></div>' +
			'<button id="menu">Cut</button>';
		const root = document.getElementById('root')!;
		const text = root.querySelector('p')!.firstChild!;
		// The phone's order: the menu takes focus, then the browser selects the word.
		document.getElementById('menu')!.focus();
		document.getSelection()!.setBaseAndExtent(text, 6, text, 10);
		const selection = createSelectionState();

		expect(readCurrentSelection(selection, [])).toBeNull();
		expect(handleRange(selection, root)).toEqual({
			start: { path: [0], offset: 6 },
			end: { path: [0], offset: 10 },
			painted: false
		});
	});
});
