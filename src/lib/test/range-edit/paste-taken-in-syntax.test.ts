// @vitest-environment jsdom
// A container the caret's container takes in brings its content, and at the caret's text start
// the content's first block keeps its own syntax: a list its marker, a heading its `#`, a nested
// quote its `>`. Only a paragraph joins from its text. An item has no marker on a blank line of its
// own under its first line, so a list pasted there keeps its own and stands nested, as typing it does.
// Miss-analysis: the taken-in rows pasted quotes of paragraphs, and the list-into-list rows put the
// caret on an item's first line, so no row took in a container whose first block was no paragraph.
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

/** `text` pasted, or typed, at `‸`, then a letter: the bytes, no dev check, a fresh read. */
async function put(marked: string, mode: PresentationMode, text: string, typed = false) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	if (typed) await insertBy('hardware key', document.activeElement as HTMLElement, text);
	else await pasteGesture(editor, { 'text/plain': text }, 'key');
	await editor.settle();
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const left = editor.source();
	await destroyMountedEditors();
	return left;
}

// [name, marked, clipboard, the bytes after a letter typed]
const ROWS: [string, string, string, string][] = [
	['a list, a bare quote line', '> a\n>\n>‸\n> b\n', '> - l', '> a\n>\n> - lZ\n>\n> b\n'],
	['a list, a spaced quote line', '> a\n>\n> ‸\n> b\n', '> - l', '> a\n>\n> - lZ\n>\n> b\n'],
	['a list, the quote’s last line', '> a\n>\n>‸\n', '> - l', '> a\n>\n> - lZ\n'],
	['two items', '> a\n>\n>‸\n> b\n', '> - l\n> - m', '> a\n>\n> - l\n> - mZ\n>\n> b\n'],
	['an ordered list', '> a\n>\n>‸\n> b\n', '> 1. l', '> a\n>\n> 1. lZ\n>\n> b\n'],
	['a heading', '> a\n>\n>‸\n> b\n', '> # h', '> a\n>\n> # hZ\n> b\n'],
	['a nested quote', '> a\n>\n> ‸\n> b\n', '> > q', '> a\n>\n> > qZ\n>\n> b\n'],
	['a list, a quote in a quote', '> > a\n> >\n> >‸\n', '> > - l', '> > a\n> >\n> > - lZ\n'],
	['a list, a quote in an item', '- > a\n  >\n  >‸\n', '> - l', '- > a\n  >\n  > - lZ\n'],
	['a list, a CRLF quote', '> a\r\n>\r\n>‸\r\n', '> - l', '> a\r\n>\r\n> - lZ\r\n'],
	['a list, an item’s empty row', '- a\n\n  ‸\n\n  b\n', '- l', '- a\n\n  - lZ\n  \n\n  b\n'],
	['two items, an item’s empty row', '- a\n\n  ‸\n', '- l\n- m', '- a\n\n  - l\n  - mZ\n'],
	['a list, a quote’s item row', '> - a\n>\n>   ‸\n', '> - l', '> - a\n>\n>   > - lZ\n'],
	// The controls: the item's first line takes the pasted item's text (C8); a heading the item
	// takes in keeps its `#` at the text start.
	['a list, an item’s first line', '- a‸\n- b\n', '- x\n- y', '- ax\n- yZ\n- b\n'],
	['a heading item, an empty item', '- ‸\n- b\n', '- # h\n- m', '- # h\n- mZ\n- b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, want] of ROWS)
		it(`${mode}: ${name}, ${JSON.stringify(clip)}`, async () => {
			expect(await put(marked, mode, clip)).toBe(want);
		});

for (const mode of ['source', 'live'] as const)
	it(`${mode}: a list pasted on an item's empty row is the list typed there`, async () => {
		const marked = '- a\n\n  ‸\n\n  b\n';
		expect(await put(marked, mode, '- l')).toBe(await put(marked, mode, '- l', true));
	});
