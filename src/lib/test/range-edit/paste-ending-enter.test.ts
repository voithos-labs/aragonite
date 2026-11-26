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
import { parse } from '#lib/core/parser.js';
import type { NodeView } from '#lib/core/node-views.js';
import {
	blocksIn,
	blocksOf,
	mountCase,
	pasteGesture,
	placeRange,
	type Editor
} from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `‸` marks the caret, `⟦…⟧` a range. */
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
	const source = marked.replace(/[‸⟦⟧]/g, '');
	const editor = mountCase(source, mode);
	await editor.settle();
	const ranged = marked.includes('⟦');
	const [from, to] = ranged
		? [marked.indexOf('⟦'), marked.indexOf('⟧') - 1]
		: [marked.indexOf('‸'), marked.indexOf('‸')];
	const point = (at: number) => pointAtByte(measured(editor.instance.__test.getDocument()), at)!;
	expect(await placeRange(editor, { anchor: point(from), focus: point(to) })).toBe(true);
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

// Miss-analysis: the rows pasted words before the ending, so none asked what spaces alone before it
// do in an item they leave blank: Enter there leaves the list or lifts the item, as on an empty one.
const BLANK_TEXT: [name: string, marked: string, clip: string][] = [
	["a space over an item's whole text", '- a\n- ⟦beta⟧\n- b\n', ' '],
	["a tab over an item's whole text", '- a\n- ⟦beta⟧\n- b\n', '\t'],
	["a space over a nested item's whole text", '- a\n  - ⟦beta⟧\n- b\n', ' '],
	['a space in an empty item', '- a\n- ‸\n- b\n', ' '],
	['a space at an item’s end', '- alpha‸\n- b\n', ' ']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip] of BLANK_TEXT)
		it(`${mode}: ${name}, then a line ending, is Enter there`, async () => {
			expect(await pasted(marked, mode, clip + '\n')).toEqual(await pasted(marked, mode, clip, 1));
		});

// Miss-analysis: the mid-text rows had a letter right after the caret, so no row asked where the
// ending leaves the caret when the new marker takes the rest's first space in, or before a run.
const BEFORE_SPACE: [name: string, marked: string, list: string][] = [
	['a bullet, before a space', '- al‸ pha\n- after\n', '- one\n- two'],
	['a bullet, before a tab', '- al‸\tpha\n- after\n', '- one\n- two'],
	['an ordered item', '1. al‸ pha\n2. after\n', '1. one\n2. two'],
	['a to-do', '- [ ] al‸ pha\n- [ ] after\n', '- [ ] one\n- [ ] two'],
	['a nested item', '- a\n  - al‸ pha\n- b\n', '- one\n- two'],
	['an item in a quote', '> - al‸ pha\n> - after\n', '- one\n- two'],
	['before a space and a run', '- al‸ **b** c\n- after\n', '- one\n- two'],
	['right before a run', '- al‸**b** c\n- after\n', '- one\n- two'],
	['before two words', '- item 2‸ word word\n- item 3\n', '- p0\n- p1']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, list] of BEFORE_SPACE)
		for (const [kind, clip] of [
			['a list', list],
			['text', 'one']
		] as const) {
			it(`${mode}: ${name}, ${kind} and its line ending leave Enter’s caret`, async () => {
				expect(await pasted(marked, mode, clip + '\n')).toEqual(
					await pasted(marked, mode, clip, 1)
				);
			});
			it(`${mode}: ${name}, ${kind} and two line endings are two Enters`, async () => {
				const ended = await pastedReloaded(marked, mode, clip, 2);
				const entered = await pasted(marked, mode, clip, 2);
				// Either side of a hidden run's opener is one place on screen (`live-mode.md` § 4.2),
				// which Enter's split and Enter at a text start name by different offsets.
				const hidden = mode === 'live' && /‸\s*\*\*/.test(marked);
				const place = (left: Left) => (hidden ? JSON.parse(left.caret).path : left.caret);
				expect([ended.after.source, place(ended.after), ended.typed]).toEqual([
					entered.after.source,
					place(entered.after),
					entered.typed
				]);
			});
		}

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
	// Miss-analysis: the rows of a pasted list joining the list under it read "opens no line" from
	// a first form of the ruling, so no row asked for the item Enter opens there.
	[
		'a paragraph over a list it joins',
		'source',
		'abc‸\n- c\n',
		'- one\n- two\n',
		'abc\n\n- one\n- two\n- \n- c\n',
		'abc\n\n- one\n- two\n- Z\n- c\n'
	],
	[
		'a paragraph over an ordered list it joins, numbered on',
		'source',
		'abc‸\n1. c\n',
		'1. one\n2. two\n',
		'abc\n\n1. one\n2. two\n3. \n4. c\n',
		'abc\n\n1. one\n2. two\n3. Z\n4. c\n'
	],
	[
		'a quote’s paragraph over a list it joins',
		'source',
		'> abc‸\n> - c\n',
		'- one\n- two\n',
		'> abc\n>\n> - one\n> - two\n> - \n> - c\n',
		'> abc\n>\n> - one\n> - two\n> - Z\n> - c\n'
	],
	[
		'a paragraph over a list it joins',
		'live',
		'abc‸\n- c\n',
		'- one\n- two\n',
		'abc\n\n- one\n- two\n- \n- c\n',
		'abc\n\n- one\n- two\n- Z\n- c\n'
	],
	[
		'a paragraph over an ordered list it joins, numbered on',
		'live',
		'abc‸\n1. c\n',
		'1. one\n2. two\n',
		'abc\n\n1. one\n2. two\n3. \n4. c\n',
		'abc\n\n1. one\n2. two\n3. Z\n4. c\n'
	],
	[
		'a quote’s paragraph over a list it joins',
		'live',
		'> abc‸\n> - c\n',
		'- one\n- two\n',
		'> abc\n>\n> - one\n> - two\n> - \n> - c\n',
		'> abc\n>\n> - one\n> - two\n> - Z\n> - c\n'
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

// Each line ending after the first is Enter where the one before left the caret: on the empty
// item the first opened, the second leaves the list, or lifts a nested item a level.

// Miss-analysis: the two-ending rows pasted words into a top-level item, whose exit reads as the
// separation's blank lines, so no row asked for a lift, a list clipboard or a number.
const TWICE: [name: string, marked: string, list: string, text: string | null][] = [
	['a bullet', '- alpha‸\n- after\n', '- one\n- two', 'one'],
	['an ordered list', '1. alpha‸\n2. after\n', '1. one\n2. two', 'one'],
	['a nested item', '- a\n  - alpha‸\n- b\n', '- one\n- two', 'one'],
	['a nested ordered item', '- a\n  1. alpha‸\n  2. after\n- b\n', '1. one\n2. two', 'one'],
	['a to-do', '- [ ] alpha‸\n- [ ] after\n', '- [ ] one\n- [ ] two', 'one'],
	['an item in a quote', '> - alpha‸\n> - after\n', '- one\n- two', 'one'],
	['the last item', '- alpha‸\n', '- one\n- two', 'one'],
	// In a paragraph the second ending adds nothing to the empty line the first opened.
	['a paragraph over a list the paste joins', 'abc‸\n- c\n', '- one\n- two', null],
	['a bullet a numbered list breaks out of', '- a‸b\n', '1. q\n2. r', 'one']
];

/** Whether a reload of `source` reads the lists `editor` holds, none of them parted by a blank line. */
function readsSameLists(editor: Editor): void {
	const source = editor.source();
	const loose = (nodes: readonly NodeView[]): boolean =>
		nodes.some(
			(n) => (n.kind === 'list' && /\n[ \t]*\n/.test(n.raw.trimEnd())) || loose(n.children ?? [])
		);
	const reload = parse(source, { grammar: editor.instance.__test.getGrammar() }).children;
	expect(blocksOf(reload)).toEqual(blocksIn(editor));
	expect(loose(reload)).toBe(false);
}

/** What a paste of `clip` and `endings` line endings leaves, its reload checked, then a letter. */
async function pastedReloaded(
	marked: string,
	mode: PresentationMode,
	clip: string,
	endings: number
) {
	const editor = await mounted(marked, mode);
	await pasteGesture(editor, { 'text/plain': clip + '\n'.repeat(endings) }, 'key');
	readsSameLists(editor);
	expect(takeDevWarns()).toEqual([]);
	const after = leftBy(editor);
	await key(editor, 'Z');
	const typed = editor.source();
	await destroyMountedEditors();
	return { after, typed };
}

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, list, text] of TWICE)
		for (const [kind, clip] of [
			['a list', list],
			['text', text]
		] as const) {
			if (clip === null) continue;
			it(`${mode}: ${name}, two line endings after ${kind} are two Enters`, async () => {
				const ended = await pastedReloaded(marked, mode, clip, 2);
				expect(ended).toEqual(await pasted(marked, mode, clip, 2));
			});
		}

// Miss-analysis: the two-ending rows skipped the paragraph host with a text clipboard, and the
// three-ending rows read "three Enters" off the comparator, so none asked what the third stacks.
for (const mode of ['source', 'live'] as const)
	for (const clip of ['1. one\n2. two', 'one']) {
		const kind = clip === 'one' ? 'text' : 'a list';
		it(`${mode}: a third line ending after ${kind} adds nothing once the second left the list`, async () => {
			const ended = await pastedReloaded('1. alpha‸\n2. after\n', mode, clip, 3);
			expect(ended).toEqual(await pasted('1. alpha‸\n2. after\n', mode, clip, 2));
		});
		it(`${mode}: a third line ending after ${kind} in a nested item leaves the list`, async () => {
			const ended = await pastedReloaded('- a\n  - alpha‸\n- b\n', mode, clip, 3);
			expect(ended).toEqual(await pasted('- a\n  - alpha‸\n- b\n', mode, clip, 3));
		});
	}

// Miss-analysis: the paragraph rows asked for one ending, where Enter's empty line is the paste's,
// so no row asked what a second ending stacks on it.
const ON_EMPTY_LINE: [name: string, marked: string, clip: string][] = [
	['a paragraph’s end', 'alpha‸\n\nAfter\n', 'one'],
	['a paragraph’s end, a list', 'alpha‸\n\nAfter\n', '- one\n- two'],
	['a paragraph’s whole text', '⟦alpha⟧\n\nAfter\n', 'one'],
	['a heading’s end', '# alpha‸\n\nAfter\n', 'one'],
	['a paragraph under a heading', '# h\nalpha‸\n\nAfter\n', '1. one\n2. two'],
	['a quote’s paragraph with more under it', '> alpha‸\n>\n> after\n', 'one'],
	['a paragraph over a list', 'abc‸\n- c\n', 'one'],
	['a CRLF document', 'alpha‸\r\n\r\nAfter\r\n', 'one']
];

// The one-ending paste is the comparator: a list's ending in a paragraph opens a line of the
// paragraph's kind (ruling 53), which Enter after the list's last item does not.
for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip] of ON_EMPTY_LINE)
		it(`${mode}: ${name}, a second and third line ending add nothing`, async () => {
			const once = await pasted(marked, mode, clip + '\n');
			expect(await pastedReloaded(marked, mode, clip, 2)).toEqual(once);
			expect(await pastedReloaded(marked, mode, clip, 3)).toEqual(once);
		});

// Miss-analysis: every stacked ending followed pasted text, so no row pasted line endings alone,
// which went in whole: two empty lines with the caret on the first, and no Enter out of a quote.
const ENDINGS_ALONE: [name: string, marked: string, second: 'nothing' | 'Enter'][] = [
	['a paragraph’s end', 'alpha‸\n\nAfter\n', 'nothing'],
	['a heading’s end', '# alpha‸\n\nAfter\n', 'nothing'],
	['a CRLF paragraph’s end', 'alpha‸\r\n\r\nAfter\r\n', 'nothing'],
	['a quote’s last paragraph', '> alpha‸\n\nAfter\n', 'Enter'],
	['an alert’s last paragraph', '> [!NOTE]\n> alpha‸\n\nAfter\n', 'Enter']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, second] of ENDINGS_ALONE)
		it(`${mode}: ${name}, of two line endings alone the second is ${second}`, async () => {
			const enters = second === 'Enter' ? 1 : 0;
			expect(await pastedReloaded(marked, mode, '', 2)).toEqual(
				await pasted(marked, mode, '\n', enters)
			);
		});

// Miss-analysis: the mid-text rows took one ending, so none asked what the second does at the start
// of the rest the first set on its line, where Enter opens a line above it.
const AT_REST: [name: string, marked: string, clip: string][] = [
	['a quote’s paragraph, text', '> al‸pha\n>\n> after\n', 'one'],
	['a quote’s paragraph, two paragraphs', '> ‸alpha\n>\n> after\n', 'one\n\ntwo']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip] of AT_REST)
		it(`${mode}: ${name}, a second line ending is Enter at the rest’s start`, async () => {
			const ended = await pastedReloaded(marked, mode, clip, 2);
			expect(ended).toEqual(await pasted(marked, mode, clip + '\n', 1));
		});

it('the ruled rows: two endings at a paragraph’s end leave one empty line', async () => {
	const text = await pasted('alpha‸\n\nAfter\n', 'source', 'one\n\n');
	expect([text.after.source, text.typed]).toEqual([
		'alphaone\n\n\nAfter\n',
		'alphaone\n\nZ\n\nAfter\n'
	]);
	expect(text).toEqual(await pasted('alpha‸\n\nAfter\n', 'source', 'one', 1));
	const list = await pasted('alpha‸\n\nAfter\n', 'source', '- one\n- two\n\n');
	expect([list.after.source, list.typed]).toEqual([
		'alpha\n\n- one\n- two\n\n\nAfter\n',
		'alpha\n\n- one\n- two\n\nZ\n\nAfter\n'
	]);
});

it('the ruled rows: two endings leave an ordered list, numbered on, and lift a nested item', async () => {
	const ordered = await pasted('1. alpha‸\n2. after\n', 'source', '1. one\n2. two\n\n');
	expect(ordered.typed).toBe('1. alphaone\n2. two\n\nZ\n\n3. after\n');
	const nested = await pasted('- a\n  - alpha‸\n- b\n', 'source', 'one\n\n');
	expect(nested.typed).toBe('- a\n  - alphaone\n- Z\n- b\n');
});

// A pasted list that joins the list under the caret's line takes its last line ending as Enter at
// its last item, as a paste without the ending and then Enter leave it.
const JOINED: [name: string, marked: string, clip: string][] = [
	['a bullet list', 'abc‸\n- c\n', '- one\n- two'],
	['an ordered list, numbered on', 'abc‸\n1. c\n', '1. one\n2. two'],
	['a list in a quote', '> abc‸\n> - c\n', '- one\n- two']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip] of JOINED)
		it(`${mode}: ${name} joined below takes its ending as Enter`, async () => {
			const ended = await pasted(marked, mode, clip + '\n');
			const entered = await pasted(marked, mode, clip, 1);
			expect(ended).toEqual(entered);
		});
