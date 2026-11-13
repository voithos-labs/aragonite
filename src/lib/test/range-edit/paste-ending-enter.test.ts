// @vitest-environment jsdom
// A clipboard's last line ending opens a line of the caret's block, as Enter there does: in a list
// item's text, a paste of `X⏎` (words, or several lines) leaves what a paste of `X` and then Enter
// leave, the next item open with the caret in it, and a letter typed next goes into that item. In
// any other block a pasted list's ending opens no item.
// Miss-analysis: the rows for a last line ending were paragraphs, where Enter leaves the empty line
// the paste left, so no row asked what Enter leaves in an item.
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
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange, type Editor } from '../range-laws/gestures';

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

/** `‸` marks the caret. */
const ROWS: [name: string, marked: string, clip: string][] = [
	['a bullet', '- alpha‸\n- after\n', 'one'],
	['an ordered list numbers on', '1. alpha‸\n2. after\n', '1. one\n2. two'],
	['a to-do', '- [ ] alpha‸\n- [ ] after\n', 'one'],
	['a checked to-do opens an unchecked one', '- [x] alpha‸\n- [ ] after\n', 'one'],
	['a nested item', '- a\n  - alpha‸\n- b\n', 'one'],
	['the second paragraph of an item', '- a\n\n  alpha‸\n- b\n', 'one'],
	['an item in a quote', '> - alpha‸\n> - after\n', 'one'],
	['mid-text', '1. al‸pha\n2. beta\n', '1. x\n2. y'],
	['a CRLF document', '- alpha‸\r\n- after\r\n', 'one'],
	['a fence in an item', '- ```\n  co‸de\n  ```\n', 'x'],
	['indented code in an item', '-     co‸de\n', 'x'],
	['a heading in an item', '- # h‸\n- b\n', 'x']
];

interface Left {
	source: string;
	caret: string;
}

async function mounted(marked: string, mode: PresentationMode): Promise<Editor> {
	const source = marked.replace('‸', '');
	const editor = mountCase(source, mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	return editor;
}

const leftBy = (editor: Editor): Left => ({
	source: editor.source(),
	caret: JSON.stringify(editor.instance.getSelection()?.focus)
});

async function key(editor: Editor, key: string): Promise<void> {
	await pressHardwareKey(document.activeElement as HTMLElement, { key });
	await editor.settle();
}

/** What a paste of `clip` leaves, after `enters` presses of Enter, and then a typed letter. */
async function pasted(marked: string, mode: PresentationMode, clip: string, enters = 0) {
	const editor = await mounted(marked, mode);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	for (let i = 0; i < enters; i++) await key(editor, 'Enter');
	const after = leftBy(editor);
	await key(editor, 'Z');
	const typed = editor.source();
	await destroyMountedEditors();
	return { after, typed };
}

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip] of ROWS)
		it(`${mode}: ${name}, the clipboard's last line ending is Enter`, async () => {
			const ended = await pasted(marked, mode, clip + '\n');
			const entered = await pasted(marked, mode, clip, 1);
			expect(ended).toEqual(entered);
		});

it('the ruled row: an ordered list ending in a line ending opens item 3', async () => {
	const { after, typed } = await pasted('1. alpha‸\n2. after\n', 'source', '1. one\n2. two\n');
	expect(after.source).toBe('1. alphaone\n2. two\n3. \n4. after\n');
	expect(typed).toBe('1. alphaone\n2. two\n3. Z\n4. after\n');
});

// Miss-analysis: every row above lands in a list item, so none asked which kind of line the
// ending opens where a pasted list lands in a paragraph.
const OTHER_HOSTS: [
	name: string,
	mode: PresentationMode,
	marked: string,
	clip: string,
	pasted: string,
	typed: string | null
][] = [
	['a paragraph’s start', 'source', '‸After\n', '- one\n- two\n', '- one\n- two\n\nAfter\n', null],
	[
		'inside a run',
		'live',
		'a **bc‸** d\n',
		'- one\n- two\n',
		'a **bc**\n\n- one\n- two\n\n d\n',
		'a **bc**\n\n- one\n- two\n\nZ d\n'
	],
	[
		'mid-text',
		'source',
		'abc‸ def\n',
		'1. one\n2. two\n',
		'abc\n\n1. one\n2. two\n\n def\n',
		'abc\n\n1. one\n2. two\n\nZ def\n'
	],
	[
		'a quote’s paragraph',
		'source',
		'> a‸ b\n',
		'- one\n- two\n',
		'> a\n>\n> - one\n> - two\n>\n>  b\n',
		'> a\n>\n> - one\n> - two\n>\n> Z b\n'
	],
	[
		'a heading',
		'source',
		'# h‸ x\n',
		'- [ ] one\n',
		'# h\n\n- [ ] one\n\n x\n',
		'# h\n\n- [ ] one\n\nZ x\n'
	],
	[
		'a quote pasted mid-text',
		'source',
		'abc‸ def\n',
		'> q\n> r\n',
		'abc\n\n> q\n> r\n\n def\n',
		'abc\n\n> q\n> r\n\nZ def\n'
	],
	[
		'nothing after the caret',
		'source',
		'abc‸\n',
		'- one\n- two\n',
		'abc\n\n- one\n- two\n\n',
		'abc\n\n- one\n- two\n\nZ\n'
	],
	// Miss-analysis: no row pasted a list over a list of its own type, which takes no empty line.
	[
		'a paragraph over a list it joins',
		'live',
		'abc‸\n- c\n',
		'- one\n- two\n',
		'abc\n\n- one\n- two\n- c\n',
		'abc\n\n- one\n- twoZ\n- c\n'
	],
	// Miss-analysis: the item rows pasted lists of the host's kind, so the kind of the item the
	// ending opens was never the host's against the clipboard's.
	[
		'a bullet a numbered list broke out of',
		'source',
		'- a‸b\n',
		'1. q\n2. r\n',
		'- a\n1. q\n2. r\n- \n- b\n',
		'- a\n1. q\n2. r\n- Z\n- b\n'
	],
	[
		'a to-do bullets joined',
		'live',
		'- [ ] a‸b\n',
		'- q\n- r\n',
		'- [ ] aq\n- r\n- [ ] b\n',
		'- [ ] aq\n- r\n- [ ] Zb\n'
	]
];

for (const [name, mode, marked, clip, want, typedWant] of OTHER_HOSTS)
	it(`${mode}: a list’s last line ending in ${name} opens a line of the caret’s block`, async () => {
		const { after, typed } = await pasted(marked, mode, clip);
		expect(after.source).toBe(want);
		if (typedWant !== null) expect(typed).toBe(typedWant);
	});

// A clipboard ending in two line endings leaves a list as a second Enter there does: the item the
// first opened parts the list as an empty line.
const TWICE: [name: string, marked: string, clip: string][] = [
	['a bullet', '- alpha‸\n- after\n', 'one'],
	['a to-do', '- [ ] alpha‸\n- [ ] after\n', 'one'],
	['an item in a quote', '> - alpha‸\n> - after\n', 'one'],
	['the last item', '- alpha‸\n', 'one']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip] of TWICE)
		it(`${mode}: ${name}, two last line endings are two Enters`, async () => {
			const ended = await pasted(marked, mode, clip + '\n\n');
			const entered = await pasted(marked, mode, clip, 2);
			expect(ended).toEqual(entered);
		});
