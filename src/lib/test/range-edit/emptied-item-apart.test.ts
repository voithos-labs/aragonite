// @vitest-environment jsdom
// An edit that leaves a list's first item with nothing on its first line, under a paragraph: an
// empty item can't interrupt a paragraph, so the blank line that keeps it a list goes above it, as a
// typed letter's write and the editor's own Backspace put it there. A paste of text, a paste of line
// endings (the item emptied, then Enter) and a removal across items, nested, in a quote, CRLF.
// Miss-analysis: no paste or removal row emptied a list's first item right under a paragraph; the
// rows emptied items under items or blank lines, where the list reads back the same.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { clipboardGesture, mountCase, pasteGesture, placeRange } from '../range-laws/gestures';
import { checkHost } from './test-host';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

type Gesture = { paste: string } | 'Backspace' | 'cut';

/** `gesture` over `⟦…⟧`: the bytes, then the bytes once `Z` is typed, no dev check. */
async function landed(marked: string, mode: PresentationMode, gesture: Gesture) {
	const editor = mountCase(marked.replace(/[⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const [from, to] = [marked.indexOf('⟦'), marked.indexOf('⟧') - 1];
	const range = { anchor: pointAtByte(doc, from)!, focus: pointAtByte(doc, to)! };
	expect(await placeRange(editor, range)).toBe(true);
	const key = (k: string) => pressHardwareKey(document.activeElement as HTMLElement, { key: k });
	if (gesture === 'cut') await clipboardGesture(editor, 'cut', 'key');
	else if (gesture === 'Backspace') await key('Backspace');
	else await pasteGesture(editor, { 'text/plain': gesture.paste }, 'key');
	await editor.settle();
	const left = editor.source();
	await key('Z');
	await editor.settle();
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return [left, typed];
}

const SPACE = { paste: ' ' };
const ENDING = { paste: '\n' };

// [name, marked, gesture, bytes left, bytes once Z is typed], in both modes.
const ROWS: [string, string, Gesture, string, string][] = [
	['a space over an item', 'a\n- ⟦beta⟧\n- b\n', SPACE, 'a\n\n-  \n- b\n', 'a\n\n-  Z\n- b\n'],
	[
		'a space over a nested item',
		'- a\n  - ⟦beta⟧\n- b\n',
		SPACE,
		'- a\n\n  -  \n- b\n',
		'- a\n\n  -  Z\n- b\n'
	],
	[
		'a space over a nested ordered item',
		'1. a\n   1. ⟦beta⟧\n2. b\n',
		SPACE,
		'1. a\n\n   1.  \n2. b\n',
		'1. a\n\n   1.  Z\n2. b\n'
	],
	[
		'a space over a nested item in a quote',
		'> - a\n>   - ⟦beta⟧\n> - b\n',
		SPACE,
		'> - a\n>\n>   -  \n> - b\n',
		'> - a\n>\n>   -  Z\n> - b\n'
	],
	[
		'a space over a nested item in a crlf file',
		'- a\r\n  - ⟦beta⟧\r\n- b\r\n',
		SPACE,
		'- a\r\n\r\n  -  \r\n- b\r\n',
		'- a\r\n\r\n  -  Z\r\n- b\r\n'
	],
	[
		"a space over an item's first line",
		'a\n- ⟦beta⟧\n  more\n',
		SPACE,
		'a\n\n-  \n  more\n',
		'a\n\n-  Z\n  more\n'
	],
	[
		'a space over an item under a quoted paragraph',
		'> a\n> - ⟦beta⟧\n> - b\n',
		SPACE,
		'> a\n>\n> -  \n> - b\n',
		'> a\n>\n> -  Z\n> - b\n'
	],
	['a line ending over an item', 'a\n- ⟦beta⟧\n- b\n', ENDING, 'a\n\n\n- b\n', 'a\n\nZ\n\n- b\n'],
	[
		'a line ending over a nested item',
		'- a\n  - ⟦beta⟧\n- b\n',
		ENDING,
		'- a\n- \n- b\n',
		'- a\n- Z\n- b\n'
	],
	[
		"a line ending over a nested item's heading",
		'- a\n  - # ⟦beta⟧\n- b\n',
		ENDING,
		'- a\n- \n- b\n',
		'- a\n- Z\n- b\n'
	],
	[
		'a line ending over a nested ordered item',
		'1. a\n   1. ⟦beta⟧\n2. b\n',
		ENDING,
		'1. a\n2. \n3. b\n',
		'1. a\n2. Z\n3. b\n'
	],
	[
		'a line ending over a nested item in a quote',
		'> - a\n>   - ⟦beta⟧\n> - b\n',
		ENDING,
		'> - a\n> - \n> - b\n',
		'> - a\n> - Z\n> - b\n'
	],
	[
		'Backspace across nested items',
		'- a\n  - ⟦beta\n  - c⟧\n- b\n',
		'Backspace',
		'- a\n\n  - \n- b\n',
		'- a\n\n  - Z\n- b\n'
	],
	[
		'a cut across nested items',
		'- a\n  - ⟦beta\n  - c⟧\n- b\n',
		'cut',
		'- a\n\n  - \n- b\n',
		'- a\n\n  - Z\n- b\n'
	],
	['Backspace across items', 'a\n- ⟦beta\n- c⟧\n', 'Backspace', 'a\n\n- \n', 'a\n\n- Z\n'],
	[
		'a space across nested items',
		'- a\n  - ⟦beta\n  - c⟧\n- b\n',
		SPACE,
		'- a\n\n  -  \n- b\n',
		'- a\n\n  -  Z\n- b\n'
	],
	[
		'a line ending across nested items',
		'- a\n  - ⟦beta\n  - c⟧\n- b\n',
		ENDING,
		'- a\n- \n- b\n',
		'- a\n- Z\n- b\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, gesture, left, typed] of ROWS)
		it(`${mode}: ${name} keeps it a list under the paragraph`, async () => {
			expect(await landed(marked, mode, gesture)).toEqual([left, typed]);
		});

// The core's answer: a block held whole, which no mounted range reaches; a typed character, whose
// text lands at once; and lines that stay, the item under an item, a heading or a blank line.
const CORE: [string, string, Gesture | 'type', string][] = [
	['a cut of a rule held whole', '- a\n  - ⟦***⟧\n- b\n', 'cut', '- a\n\n  - ‸\n- b\n'],
	['a line ending over a rule held whole', '- a\n  - ⟦***⟧\n- b\n', ENDING, '- a\n- ‸\n- b\n'],
	['a space over a rule held whole', '- a\n  - ⟦***⟧\n- b\n', SPACE, '- a\n\n  -  ‸\n- b\n'],
	['a typed character across items', '- a\n  - ⟦beta\n  - c⟧\n- b\n', 'type', '- a\n  - ‸\n- b\n'],
	[
		'text pasted across items',
		'- a\n  - ⟦beta\n  - c⟧\n- b\n',
		{ paste: 'x' },
		'- a\n  - x‸\n- b\n'
	],
	['a space over a second item', '- a\n- ⟦beta⟧\n- b\n', SPACE, '- a\n-  ‸\n- b\n'],
	['a space over a second nested item', '- a\n  - x\n  - ⟦b⟧\n', SPACE, '- a\n  - x\n  -  ‸\n'],
	['a space over an item under a heading', '# h\n- ⟦beta⟧\n- b\n', SPACE, '# h\n-  ‸\n- b\n'],
	['a space over an item under a blank line', 'a\n\n- ⟦beta⟧\n', SPACE, 'a\n\n-  ‸\n'],
	['a cut across items under a heading', '# h\n- ⟦beta\n- c⟧\n', 'cut', '# h\n- ‸\n'],
	['a cut across second nested items', '- a\n  - x\n  - ⟦b\n  - c⟧\n', 'cut', '- a\n  - x\n  - ‸\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, gesture, want] of CORE)
		it(`${mode}: the core's answer for ${name}`, () => {
			const source = marked.replace(/[⟦⟧]/g, '');
			const range = { from: marked.indexOf('⟦'), to: marked.indexOf('⟧') - 1 };
			const asked =
				typeof gesture === 'object'
					? { paste: gesture.paste, plain: false, holds: 'text' as const }
					: gesture === 'Backspace'
						? 'backspace'
						: gesture;
			const got = editRange(source, range, asked, mode, checkHost());
			expect(got.source.slice(0, got.caret.at) + '‸' + got.source.slice(got.caret.at)).toBe(want);
		});

// In live mode a heading's whole text written over takes its markers: the item is emptied.
it('live: a space over a nested heading keeps the item a list under the paragraph', async () => {
	const marked = '- a\n  - # ⟦beta⟧\n- b\n';
	const got = await landed(marked, 'live', SPACE);
	expect(got).toEqual(['- a\n\n  -  \n- b\n', '- a\n\n  -  Z\n- b\n']);
});
