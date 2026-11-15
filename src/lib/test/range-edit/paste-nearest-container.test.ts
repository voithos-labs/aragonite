// @vitest-environment jsdom
// A paste lands in the container nearest its place: a quote or a callout an item holds is that
// quote or callout, so a list pasted there stands in it as a block and its endings are Enters there.
// A pasted container merges into one around the place only where the clipboard opens with every
// container from that one down to the place's own, as a cut pasted back does.
// Miss-analysis: the merge rows put the caret straight in the container of the pasted kind, so no row
// asked what a container of another kind between the two does.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted by the key at `‸`, then `enters` presses of Enter and `Z`: the bytes. */
async function typedAfter(marked: string, mode: PresentationMode, clip: string, enters = 0) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	for (const key of [...Array(enters).fill('Enter'), 'Z']) {
		await pressHardwareKey(document.activeElement as HTMLElement, { key });
		await editor.settle();
	}
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	return editor.source();
}

const IN_ITEM = '- > alpha‸\n- after\n';
const MODES: PresentationMode[] = ['source', 'live'];

// [name, marked, clipboard, the bytes once `Z` is typed]
const ROWS: [string, string, string, string][] = [
	[
		'a list in a quote an item holds',
		IN_ITEM,
		'- one\n- two',
		'- > alpha\n  >\n  > - one\n  > - twoZ\n- after\n'
	],
	[
		'a list with its ending opens a line of the quote',
		IN_ITEM,
		'- one\n- two\n',
		'- > alpha\n  >\n  > - one\n  > - two\n  >\n  > Z\n- after\n'
	],
	[
		'a nested list with its ending, the same',
		IN_ITEM,
		'- one\n  - two\n',
		'- > alpha\n  >\n  > - one\n  >   - two\n  >\n  > Z\n- after\n'
	],
	[
		'a list with its ending at an open quote in an item',
		'- > alpha‸',
		'- one\n- two\n',
		'- > alpha\n  >\n  > - one\n  > - two\n  >\n  > Z\n'
	],
	[
		'a list in a callout an item holds',
		'- :::note\n  alpha‸\n  :::\n- after\n',
		'- x\n- y',
		'- :::note\n  alpha\n\n  - x\n  - yZ\n  :::\n- after\n'
	],
	[
		'a callout in a quote a callout holds',
		':::note\n> alpha‸\n:::\n',
		':::note\nq\n:::',
		':::note\n> alpha\n>\n> :::note\n> qZ\n> :::\n:::\n'
	],
	[
		'a quote in an item a quote holds, its ending the item’s Enter',
		'> - alpha‸\n> - b\n',
		'> q\n',
		'> - alpha\n>\n>   > q\n> - Z\n> - b\n'
	],
	[
		'a clipboard opening with the containers around the place merges',
		IN_ITEM,
		'- > q\n',
		'- > alphaq\n- Z\n- after\n'
	]
];

for (const [name, marked, clip, typed] of ROWS)
	for (const mode of MODES)
		it(`${name}, ${mode}`, async () => {
			expect(await typedAfter(marked, mode, clip)).toBe(typed);
		});

// A quote that joins the place's quote ends inside it, so its endings are text's there; a heading
// with its endings is the paste without them and then that many Enters.
for (const marked of [IN_ITEM, '- > alpha‸'])
	for (const mode of MODES)
		for (const endings of ['\n', '\n\n']) {
			it(`a quote with ${endings.length} ending(s) at ${JSON.stringify(marked)}, ${mode}`, async () => {
				expect(await typedAfter(marked, mode, `> quo${endings}`)).toBe(
					await typedAfter(marked, mode, `quo${endings}`)
				);
			});
			it(`a heading with ${endings.length} ending(s) at ${JSON.stringify(marked)}, ${mode}`, async () => {
				expect(await typedAfter(marked, mode, `p\n\n# head${endings}`)).toBe(
					await typedAfter(marked, mode, 'p\n\n# head', endings.length)
				);
			});
		}
