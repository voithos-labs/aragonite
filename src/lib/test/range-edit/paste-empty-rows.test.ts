// @vitest-environment jsdom
// A paste that fills an empty line gives the block under it back its separator, as a typed letter
// there does: the empty line was that block's separator, a row or any other block. One, two and
// three rows, the only row over a heading, a quote, a list or a fence, the line a range keeps; at
// the top level, in an item, a quote and a callout, CRLF; text by every paste route, blocks, line
// endings. After each, the tree equals a fresh read of the bytes.
// Miss-analysis: the rows filled an empty line with one row under it or none, where the pasted
// block's own blank line is the follower's separator, so none asked what a second row becomes;
// and the one only row they pasted on lay over a paragraph, which takes the blank line anyway.
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
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import {
	mountCase,
	pasteGesture,
	pastePlainGesture,
	placeRange,
	shiftPaste
} from '../range-laws/gestures';
import { checkHost } from './test-host';

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

/** A paste by the key, the menu's plain row, Ctrl+Shift+V or `insertMarkdown`, or a typed key. */
type Gesture = 'paste' | 'plain' | 'shift' | 'markdown' | 'type';

/** `text` put in at `‸`, or over `⟦⟧`, by `gesture`, then `enters` presses of Enter: the bytes, then
 *  the bytes once `Z` is typed, with no dev check and a tree a fresh read of its bytes gives. */
async function filled(
	marked: string,
	mode: PresentationMode,
	gesture: Gesture,
	text: string,
	enters = 0
) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const from = marked.search(/[‸⟦]/);
	const to = marked.includes('⟧') ? marked.indexOf('⟧') - 1 : from;
	const doc = measured(editor.instance.__test.getDocument());
	const [anchor, focus] = [pointAtByte(doc, from)!, pointAtByte(doc, to)!];
	expect(await placeRange(editor, { anchor, focus })).toBe(true);
	const focused = () => document.activeElement as HTMLElement;
	if (gesture === 'paste') await pasteGesture(editor, { 'text/plain': text }, 'key');
	else if (gesture === 'markdown')
		await pasteGesture(editor, { 'text/plain': text }, 'insertMarkdown');
	else if (gesture === 'plain') await pastePlainGesture(editor, text);
	else if (gesture === 'shift') await shiftPaste(editor, text);
	else await insertBy('hardware key', focused(), text);
	await editor.settle();
	for (let i = 0; i < enters; i++) {
		await pressHardwareKey(focused(), { key: 'Enter' });
		await editor.settle();
	}
	const left = editor.source();
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	await pressHardwareKey(focused(), { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const typed = editor.source();
	await destroyMountedEditors();
	return [left, typed];
}

// [name, the document, the caret on an empty line]
const HOSTS: [string, string][] = [
	['the first of two empty rows', 'a\n\n‸\n\nb\n'],
	['the first of three empty rows', 'a\n\n‸\n\n\nb\n'],
	['the second of three empty rows', 'a\n\n\n‸\n\nb\n'],
	['two empty rows that end the document', 'a\n\n‸\n\n'],
	['two empty rows that open the document', '‸\n\n\nb\n'],
	['two empty rows in an item', '- a\n\n  ‸\n\n  b\n'],
	['two empty rows in a callout', ':::note\na\n\n‸\n\nb\n:::\n'],
	['two empty rows in a CRLF document', 'a\r\n\r\n‸\r\n\r\nb\r\n'],
	['two empty rows in a quote', '> a\n>\n>‸\n>\n> b\n']
];

// The only empty row over a block, and the line a range keeps after a blank line (the range took
// the blank line under it): a block of any kind gets its separator back.
const ONLY_ROW: [string, string][] = [
	['the only empty row, over a paragraph', 'a\n\n‸\nb\n'],
	['the only empty row, over a heading', 'a\n\n‸\n# b\n'],
	['the only empty row, over a quote', 'a\n\n‸\n> b\n'],
	['the only empty row, over a list', 'a\n\n‸\n- b\n'],
	['the only empty row, over a fence', 'a\n\n‸\n```\nc\n```\n'],
	['the only empty row in a quote, over a heading', '> a\n>\n>‸\n> # b\n'],
	['the line a range keeps, before a heading', 'first\n\n⟦zero\n\npara⟧\n\n# next\n'],
	['the line a range keeps, before a fence', 'first\n\n⟦zero\n\npara⟧\n\n```\nc\n```\n'],
	['the line a range keeps, before a list', 'first\n\n⟦zero\n\npara⟧\n\n- x\n'],
	['the line a range from a rule keeps', 'first\n\n⟦***\n\npara⟧\n\n# next\n'],
	['a range inside one paragraph, before a heading', 'first\n\n⟦para⟧\n\n# next\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of [...HOSTS, ...ONLY_ROW])
		for (const gesture of ['paste', 'plain', 'shift', 'markdown'] as const)
			it(`${mode}: text by ${gesture} on ${name} writes what a typed letter writes`, async () => {
				const typed = await filled(marked, mode, 'type', 'X');
				expect(await filled(marked, mode, gesture, 'X')).toEqual(typed);
			});

// A last line ending at the text's end is Enter there (ruling 79).
for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of HOSTS)
		it(`${mode}: text and its line ending on ${name} is the text, then Enter`, async () => {
			const entered = await filled(marked, mode, 'paste', 'X', 1);
			expect(await filled(marked, mode, 'paste', 'X\n')).toEqual(entered);
		});

// Blocks, as the paste dispatcher's rows had them; a quote's last line ending holds the caret on
// the separator under it, as a gap, so the second row stays the row it was.
const BLOCKS: [string, string, string, string][] = [
	['a quote', 'a\n\n‸\nb\n', '> q', 'a\n\n> q\n\nb\n'],
	['a quote', 'a\n\n‸\n\nb\n', '> q', 'a\n\n> q\n\n\nb\n'],
	['a quote and its line ending', 'a\n\n‸\nb\n', '> q\n', 'a\n\n> q\n\nb\n'],
	['a quote and its line ending', 'a\n\n‸\n\nb\n', '> q\n', 'a\n\n> q\n\n\nb\n'],
	['two paragraphs', 'a\n\n‸\nb\n', 'x\n\ny', 'a\n\nx\n\ny\n\nb\n'],
	['two paragraphs', 'a\n\n‸\n\nb\n', 'x\n\ny', 'a\n\nx\n\ny\n\n\nb\n'],
	['a heading', 'a\n\n‸\n\n\nb\n', '# h', 'a\n\n# h\n\n\n\nb\n'],
	['a list', 'a\n\n‸\n\nb\n', '- l', 'a\n\n- l\n\n\nb\n'],
	['a quote in an item', '- a\n\n  ‸\n\n  b\n', '> q', '- a\n\n  > q\n  \n\n  b\n'],
	['a list that joins the one under it', 'a\n\n‸\n- b\n', '- l', 'a\n\n- l\n- b\n'],
	['two paragraphs', 'a\n\n‸\n# b\n', 'x\n\ny', 'a\n\nx\n\ny\n\n# b\n'],
	[
		'two paragraphs',
		'first\n\n⟦zero\n\npara⟧\n\n# next\n',
		'x\n\ny',
		'first\n\nx\n\ny\n\n# next\n'
	],
	['a heading', 'a\n\n‸\n# b\n', '# h', 'a\n\n# h\n\n# b\n'],
	['a quote', 'a\n\n‸\n# b\n', '> q', 'a\n\n> q\n\n# b\n'],
	['a list', 'a\n\n‸\n# b\n', '- l', 'a\n\n- l\n\n# b\n'],
	['a fence', 'a\n\n‸\n# b\n', '```\nc\n```', 'a\n\n```\nc\n```\n\n# b\n'],
	// Over a block that is no row, the empty line the ending opens stands for its separator.
	['text and its line ending', 'a\n\n‸\n# b\n', 'X\n', 'a\n\nX\n\n# b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, left] of BLOCKS)
		it(`${mode}: ${name} on ${JSON.stringify(marked)} keeps the other rows`, async () => {
			expect((await filled(marked, mode, 'paste', clip))[0]).toBe(left);
		});

// A paste writes no blank line between an item's first line and the item's next block, where a
// typed letter still writes one and turns the list loose; a block the text would read into is set
// apart. Miss-analysis: every only row lay over a sibling, none over a block of the item's own.
const SUBLIST: [string, string, string][] = [
	['a bullet over its sublist', '- ‸\n  - b\n', '- X\n  - b\n'],
	['an ordered item over its sublist', '1. ‸\n   - b\n', '1. X\n   - b\n'],
	['an ordered item over its ordered sublist', '1. ‸\n   1. b\n', '1. X\n   1. b\n'],
	['a to-do over its sublist', '- [ ] ‸\n  - b\n', '- [ ] X\n  - b\n'],
	[
		'a nested item over its sublist',
		'- x\n  - y\n  - ‸\n    - b\n',
		'- x\n  - y\n  - X\n    - b\n'
	],
	['a quoted bullet over its sublist', '> - ‸\n>   - b\n', '> - X\n>   - b\n'],
	['an item over a sublist numbered from 2', '1. ‸\n   2. b\n', '1. X\n\n   2. b\n'],
	['a bullet that has text, over its sublist', '- x‸\n  - b\n', '- xX\n  - b\n'],
	['a bullet over a quote of its own', '- ‸\n  > b\n', '- X\n  > b\n'],
	['a bullet over a heading of its own', '- ‸\n  # b\n', '- X\n  # b\n'],
	['a bullet over a fence of its own', '- ‸\n  ```\n  c\n  ```\n', '- X\n  ```\n  c\n  ```\n'],
	['a quoted bullet over a quote of its own', '> - ‸\n>   > b\n', '> - X\n>   > b\n'],
	['a bullet over a line that would underline it', '- ‸\n  ---\n', '- X\n\n  ---\n'],
	['a bullet over indented code of its own', '- ‸\n      c\n', '- X\n\n      c\n'],
	['a bullet over a paragraph of its own', '- ‸\n  b\n', '- X\n\n  b\n'],
	['a bullet right over a heading outside the list', '- ‸\n# b\n', '- X\n# b\n'],
	['an item’s later empty line, over a list', '- a\n\n  ‸\n  - b\n', '- a\n\n  X\n  \n  - b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, left] of SUBLIST)
		for (const gesture of ['paste', 'plain', 'shift', 'markdown'] as const)
			it(`${mode}: text by ${gesture} in ${name} keeps the list as it reads`, async () => {
				expect((await filled(marked, mode, gesture, 'X'))[0]).toBe(left);
			});

// Text with its line ending is the text, then Enter: the item it opens takes the sublist.
const SUBLIST_BLOCKS: [string, string, string][] = [
	['two paragraphs', 'X\n\nY', '- X\n\n  Y\n  - b\n'],
	['a heading', '# h', '- # h\n  - b\n'],
	['text and its line ending', 'X\n', '- X\n- \n  - b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, clip, left] of SUBLIST_BLOCKS)
		it(`${mode}: ${name} in a bullet over its sublist writes no blank line over it`, async () => {
			expect((await filled('- ‸\n  - b\n', mode, 'paste', clip))[0]).toBe(left);
		});

it.each(['source', 'live'] as const)(
	'%s: text and its line ending in a bullet over a quote of its own opens the next item',
	async (mode) => {
		expect((await filled('- ‸\n  > b\n', mode, 'paste', 'X\n'))[0]).toBe('- X\n- \n  > b\n');
	}
);

// Blocks on an empty heading's line take the heading's place: the blank line under it was its
// separator, never a row. Miss-analysis: every row's empty line was a blank paragraph's.
const HEADING: [string, string, string][] = [
	['# ‸\n\nb\n', '# h', '# h\n\nb\n'],
	['# ‸\n\nb\n', '> q', '> q\n\nb\n'],
	['a\n\n# ‸\n\nb\n', '- l', 'a\n\n- l\n\nb\n'],
	['# ‸\n\n\n\nb\n', '# h', '# h\n\n\n\nb\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [marked, clip, left] of HEADING)
		it(`${mode}: ${clip} on the empty heading of ${JSON.stringify(marked)}`, async () => {
			expect((await filled(marked, mode, 'paste', clip))[0]).toBe(left);
		});

// The core's answer: an open fence takes the row into its body, so no line goes in; text over a
// block held whole takes its line, and the blank line under it was its separator, never a row.
const CORE: [string, string, string, string][] = [
	['an open fence', 'a\n\n‸\n\nb\n', '```', 'a\n\n```‸\n\nb\n'],
	['text over a rule held whole', 'a\n\n⟦***⟧\n\nb\n', 'x', 'a\n\nx‸\n\nb\n'],
	['text over a rule held whole, a row under it', 'a\n\n⟦***⟧\n\n\nb\n', 'x', 'a\n\nx‸\n\n\nb\n'],
	['text over a heading held whole, over a heading', '⟦# h⟧\n\n# b\n', 'x', 'x‸\n\n# b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, want] of CORE)
		it(`${mode}: the core's answer for ${name}`, () => {
			const source = marked.replace(/[‸⟦⟧]/g, '');
			const from = marked.search(/[‸⟦]/);
			const to = marked.includes('⟧') ? marked.indexOf('⟧') - 1 : from;
			const gesture = { paste: clip, plain: false, holds: 'text' as const };
			const got = editRange(source, { from, to }, gesture, mode, checkHost());
			expect(got.source.slice(0, got.caret.at) + '‸' + got.source.slice(got.caret.at)).toBe(want);
		});
