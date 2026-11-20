// @vitest-environment jsdom
// A paste without its last line ending leaves the caret at the last place a caret takes in what it
// pasted, in both modes: a code block's or a callout's body end, a header-only table's last cell.
// A letter typed next goes there, never on a closing line the write rule would answer with a closer.
// Miss-analysis: the caret rows pasted text, headings and lists, whose last line is text, and no
// row typed a letter after a block that ends on a line no caret takes.
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
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const FENCE = '```\ncode\n```';
const CALLOUT = ':::note\nbody\n:::';
const DETAILS = '<details open>\n<summary>s</summary>\n\nbody\n\n</details>';
const HEADER = '| a | b |\n| - | - |';

/** `‸` marks the caret; `typed` is the source once `Z` is typed after the paste. */
const ROWS: [name: string, marked: string, clip: string, typed: string][] = [
	['a fence', 'abc‸\n', FENCE, 'abc\n\n```\ncodeZ\n```\n'],
	['a fence in an item', '- a‸\n- b\n', FENCE, '- a\n\n  ```\n  codeZ\n  ```\n- b\n'],
	['a fence in a quote', '> a‸\n> b\n', FENCE, '> a\n>\n> ```\n> codeZ\n> ```\n> b\n'],
	['a callout', 'abc‸\n', CALLOUT, 'abc\n\n:::note\nbodyZ\n:::\n'],
	['a callout in an item', '- a‸\n- b\n', CALLOUT, '- a\n\n  :::note\n  bodyZ\n  :::\n- b\n'],
	['a callout in a quote', '> a‸\n> b\n', CALLOUT, '> a\n>\n> :::note\n> bodyZ\n> :::\n> b\n'],
	['a details block', 'abc‸\n', DETAILS, `abc\n\n${DETAILS.replace('body', 'bodyZ')}\n`],
	[
		'a details block in an item',
		'- a‸\n- b\n',
		DETAILS,
		'- a\n\n  <details open>\n  <summary>s</summary>\n\n  bodyZ\n\n  </details>\n- b\n'
	],
	[
		'a details block in a quote',
		'> a‸\n> b\n',
		DETAILS,
		'> a\n>\n> <details open>\n> <summary>s</summary>\n>\n> bodyZ\n>\n> </details>\n> b\n'
	],
	['a header-only table', 'abc‸\n', HEADER, 'abc\n\n| a | bZ |\n| - | - |\n'],
	[
		'a header-only table in an item',
		'- a‸\n- b\n',
		HEADER,
		'- a\n\n  | a | bZ |\n  | - | - |\n- b\n'
	],
	[
		'a header-only table over an item’s text',
		'- ‸a‸\n- b\n',
		HEADER,
		'- | a | bZ |\n  | - | - |\n- b\n'
	]
];

async function pastedThenTyped(marked: string, mode: PresentationMode, clip: string) {
	const [from, to] = [marked.indexOf('‸'), marked.lastIndexOf('‸') - 1];
	const editor = mountCase(marked.replaceAll('‸', ''), mode);
	await editor.settle();
	const tree = measured(editor.instance.__test.getDocument());
	const range = { anchor: pointAtByte(tree, from)!, focus: pointAtByte(tree, Math.max(from, to))! };
	expect(await placeRange(editor, range)).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	const caret = editor.instance.getSelection()?.focus;
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	return { typed: editor.source(), caret };
}

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, typed] of ROWS)
		it(`${mode}: a letter after ${name} pasted without its ending goes in its last text`, async () => {
			expect((await pastedThenTyped(marked, mode, clip)).typed).toBe(typed);
		});

// A `$$` block takes no typed letter in this harness, so its row reads the caret: the body's end.
for (const mode of ['source', 'live'] as const)
	it(`${mode}: a $$ block pasted without its ending leaves the caret at its body’s end`, async () => {
		const { caret } = await pastedThenTyped('abc‸\n', mode, '$$\nx\n$$');
		expect(caret).toEqual({ path: [1], offset: 4 });
	});

// With its ending, a block pasted at an item's text start opens the empty line before the text,
// which takes the caret as a gap in the item: a letter there starts a line of its own.

// Miss-analysis: the ending rows pasted at a text's end, so no row asked where the caret goes when
// the text after it moves under a closing line.
const OPENING: [name: string, marked: string, first: string, more: string, tail: string][] = [
	['a bullet', '- ‸alpha\n- after\n', '- ', '  ', '- after\n'],
	['a nested bullet', '- top\n  - ‸alpha\n- after\n', '- top\n  - ', '    ', '- after\n'],
	['a quoted bullet', '> - ‸alpha\n> - after\n', '> - ', '>   ', '> - after\n'],
	['a to-do', '- [ ] ‸alpha\n- [ ] after\n', '- ', '  ', '- [ ] after\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, first, more, tail] of OPENING)
		for (const block of [FENCE, '$$\nx\n$$', CALLOUT])
			it(`${mode}: a letter after ${block.split('\n')[0]} pasted with its ending at ${name}’s text start starts a line`, async () => {
				const line = (text: string) => `${text ? more + text : more.trimEnd()}\n`;
				const lines = block.split('\n').map((text, i) => (i ? line(text) : `${first}${text}\n`));
				const typed = [...lines, line(''), line('Z'), line(''), line('alpha')].join('') + tail;
				expect((await pastedThenTyped(marked, mode, `${block}\n`)).typed).toBe(typed);
			});
