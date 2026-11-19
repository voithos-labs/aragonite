// @vitest-environment jsdom
// A container the caret's container takes in, pasted after text (at a later line's start of the
// caret's paragraph, at a line's end, mid-line), lands as its content pasted there: a first block
// that is no paragraph keeps its syntax on a line of its own, the paragraph cut where the caret is,
// a blank line between, and the text after the caret goes to the last block where it takes text.
// Miss-analysis: the taken-in rows kept the first block's syntax at the caret's text start only, and
// no row pasted a quote of a heading or a fence after text, where its `#` and fence lines went.
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

/** What a paste of `clip` at `‸` leaves, then that with `Z` typed; no dev check may fire. */
async function pasted(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	const after = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const typed = editor.source();
	await destroyMountedEditors();
	return [after, typed];
}

const FENCE = '```\nc\n```';

/** `‸` marks the caret; `after` is the source the paste leaves, `typed` it once `Z` is typed. */
const ROWS: [name: string, marked: string, clip: string, after: string, typed: string][] = [
	[
		'a heading, at a later line’s start',
		'> a\n> ‸b\n',
		'> # h',
		'> a\n>\n> # hb\n',
		'> a\n>\n> # hZb\n'
	],
	[
		'a fence, at a later line’s start',
		'> a\n> ‸b\n',
		'> ```\n> c\n> ```',
		'> a\n>\n> ```\n> c\n> ```\n> b\n',
		'> a\n>\n> ```\n> cZ\n> ```\n> b\n'
	],
	['a heading in an item', '- a\n  ‸b\n', '- # h', '- a\n\n  # hb\n', '- a\n\n  # hZb\n'],
	[
		'a heading in an alert',
		'> [!NOTE]\n> a\n> ‸b\n',
		'> [!NOTE]\n> # h',
		'> [!NOTE]\n> a\n>\n> # hb\n',
		'> [!NOTE]\n> a\n>\n> # hZb\n'
	],
	[
		'a heading, CRLF',
		'> a\r\n> ‸b\r\n',
		'> # h',
		'> a\r\n>\r\n> # hb\r\n',
		'> a\r\n>\r\n> # hZb\r\n'
	],
	[
		'a heading in a quote in a quote',
		'> > a\n> > ‸b\n',
		'> # h',
		'> > a\n> >\n> > # hb\n',
		'> > a\n> >\n> > # hZb\n'
	],
	[
		'a heading of two lines, at a line’s end',
		'> a‸\n> b\n',
		'> # h\n> more',
		'> a\n>\n> # h\n> more\n> b\n',
		'> a\n>\n> # h\n> moreZ\n> b\n'
	],
	[
		'a list, mid-line',
		'> a‸b\n',
		'> - l\n> - m',
		'> a\n>\n> - l\n> - mb\n',
		'> a\n>\n> - l\n> - mZb\n'
	],
	[
		'an item opening with a list, the caret’s item’s sublist with no blank line',
		'- i1‸\n- i3\n',
		'- - i2\n- i4',
		'- i1\n  - i2\n- i4\n- i3\n',
		'- i1\n  - i2\n- i4Z\n- i3\n'
	],
	[
		'a fence in an item, at a line’s end',
		'- a‸\n  b\n',
		'- ```\n  c\n  ```',
		'- a\n\n  ```\n  c\n  ```\n  b\n',
		'- a\n\n  ```\n  cZ\n  ```\n  b\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, after, typed] of ROWS)
		it(`${mode}: ${name}`, async () => {
			expect(await pasted(marked, mode, clip)).toEqual([after, typed]);
		});

// The same clipboard as its content: the container's markers off each line.
const QUOTES: [name: string, clip: string][] = [
	['a heading', '> # h'],
	['a fence', `> ${FENCE.replaceAll('\n', '\n> ')}`],
	['a list', '> - l'],
	['a heading of two lines', '> # h\n> more'],
	['a list of two items', '> - l\n> - m'],
	['a paragraph, then a heading', '> x\n>\n> # h']
];
const HOSTS: [name: string, marked: string][] = [
	['a later line’s start', '> a\n> ‸b\n'],
	['a later line’s start, two deep', '> > a\n> > ‸b\n'],
	['a later line’s start, CRLF', '> a\r\n> ‸b\r\n'],
	['the text start', '> ‸ab\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [kind, clip] of QUOTES)
		for (const [where, marked] of HOSTS)
			it(`${mode}: ${kind} taken in at ${where} lands as its content`, async () => {
				const content = clip.replace(/^> ?/gm, '');
				expect(await pasted(marked, mode, clip)).toEqual(await pasted(marked, mode, content));
			});
