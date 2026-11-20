// @vitest-environment jsdom
// A clipboard pasted in a list item whose last block left the item's list (a paragraph, a quote or
// a table under a pasted list) ends in a line ending: the ending opens an item of the host's kind
// under that block, as a block of its own. It stands a blank line apart where a reload would read
// its marker into the block above, and it heads the host's items below, numbered on.
// Miss-analysis: the rows that broke out of the host's list ended on a list of another kind or a
// rule, under which a marker starts an item, so no row opened one under a paragraph or a container.
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
import { parse } from '#lib/core/parser.js';
import { blocksIn, blocksOf, mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

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

/** The bytes a paste of `clip` leaves at `‸`, then once `Z` is typed; the tree reads back from the
 *  bytes both times, and no dev check fires on the way. */
async function pasted(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	const left = editor.source();
	expect(blocksOf(parse(left).children)).toEqual(blocksIn(editor));
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	expect(blocksOf(parse(typed).children)).toEqual(blocksIn(editor));
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return [left, typed];
}

const ROWS: [name: string, marked: string, clip: string, left: string, typed: string][] = [
	[
		'a paragraph under a bullet',
		'- aaa\n- ‸\n- bbb\n',
		'- one\n\ntwo\n',
		'- aaa\n- one\n\ntwo\n\n- \n- bbb\n',
		'- aaa\n- one\n\ntwo\n\n- Z\n- bbb\n'
	],
	[
		'a paragraph in an ordered list, numbered on',
		'1. aaa\n2. ‸\n3. bbb\n',
		'- one\n\ntwo\n',
		'1. aaa\n- one\n\ntwo\n\n2. \n3. bbb\n',
		'1. aaa\n- one\n\ntwo\n\n2. Z\n3. bbb\n'
	],
	[
		'a paragraph at the last item’s end',
		'- aaa\n- bbb‸\n\nAfter\n',
		'- one\n\ntwo\n',
		'- aaa\n- bbbone\n\ntwo\n\n- \n\nAfter\n',
		'- aaa\n- bbbone\n\ntwo\n\n- Z\n\nAfter\n'
	],
	[
		'a paragraph in a quoted list',
		'> - aaa\n> - ‸\n> - bbb\n',
		'- one\n\ntwo\n',
		'> - aaa\n> - one\n>\n> two\n>\n> - \n> - bbb\n',
		'> - aaa\n> - one\n>\n> two\n>\n> - Z\n> - bbb\n'
	],
	[
		'a quote under a bullet, which the editor reads the marker out of',
		'- aaa\n- ‸\n- bbb\n',
		'- one\n\n> quo\n',
		'- aaa\n- one\n\n> quo\n- \n- bbb\n',
		'- aaa\n- one\n\n> quo\n- Z\n- bbb\n'
	],
	[
		'a heading under a bullet',
		'- aaa\n- ‸\n- bbb\n',
		'- one\n\n# head\n',
		'- aaa\n- one\n\n# head\n- \n- bbb\n',
		'- aaa\n- one\n\n# head\n- Z\n- bbb\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, left, typed] of ROWS)
		it(`${mode}: ${name}, the ending opens the host’s item as a block of its own`, async () => {
			expect(await pasted(marked, mode, clip)).toEqual([left, typed]);
		});

// A table's last row takes a line under it as it reads there, so the row holds the landing alone.
for (const mode of ['source', 'live'] as const)
	it(`${mode}: a table under a bullet, the ending opens the host’s item under it`, async () => {
		const table = '| h |\n| - |\n| c |';
		const [left, typed] = await pasted('- aaa\n- ‸\n- bbb\n', mode, `- one\n\n${table}\n`);
		expect(left).toContain(table);
		expect(typed.endsWith('- Z\n- bbb\n')).toBe(true);
	});
