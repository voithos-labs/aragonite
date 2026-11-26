// @vitest-environment jsdom
// A paste on a quote's blank line spelled `>` alone writes `> ` before the text it puts there and
// on every line it adds, as a typed letter does, and a pasted quote the caret's quote takes in
// keeps a blank line from the paragraph under it.
// Miss-analysis: the quote rows put the caret on `> ` lines, spelled with the space, so no row
// pasted on a bare `>` line or took a quote in there.
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
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
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

/** `text` pasted, or typed, at `‸` or over `⟦ ⟧`: the bytes, no dev check, a tree a fresh read of its
 *  bytes gives. */
async function put(marked: string, mode: PresentationMode, text: string, typed = false) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const from = marked.search(/[‸⟦]/);
	const to = marked.includes('⟧') ? marked.indexOf('⟧') - 1 : from;
	const [anchor, focus] = [pointAtByte(doc, from)!, pointAtByte(doc, to)!];
	expect(await placeRange(editor, { anchor, focus })).toBe(true);
	if (typed) await insertBy('hardware key', document.activeElement as HTMLElement, text);
	else await pasteGesture(editor, { 'text/plain': text }, 'key');
	await editor.settle();
	const left = editor.source();
	expect(
		describeConvergence(editor.instance.__test.getDocument(), editor.instance.__test.getGrammar())
	).toBeNull();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return left;
}

const BARE: [string, string][] = [
	['a quote', '> a\n>\n>‸\n> b\n'],
	['a quote that ends the document', '> a\n>\n>‸\n'],
	['a quote in a quote', '> > a\n> >\n> >‸\n> > b\n'],
	['a quote in an item', '- > a\n  >\n  >‸\n  > b\n'],
	['a quote in a CRLF document', '> a\r\n>\r\n>‸\r\n> b\r\n'],
	['a quote whose text lines are bare too', '>a\n>\n>‸\n>b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of BARE)
		it(`${mode}: text on the bare blank line of ${name} is spelled as a typed letter's`, async () => {
			expect(await put(marked, mode, 'X')).toBe(await put(marked, mode, 'X', true));
		});

// [name, the clipboard, the bytes] on `> a\n>\n>‸\n> b\n`.
const PASTED: [string, string, string][] = [
	['two paragraphs', 'X\n\nY', '> a\n>\n> X\n>\n> Y\n>\n> b\n'],
	['two lines', 'two\nlines', '> a\n>\n> two\n> lines\n>\n> b\n'],
	['a quote', '> X', '> a\n>\n> X\n>\n> b\n'],
	['a quote of two paragraphs', '> X\n>\n> Y', '> a\n>\n> X\n>\n> Y\n>\n> b\n'],
	['a quote holding a fence', '> ```\n> code\n> ```', '> a\n>\n> ```\n> code\n> ```\n>\n> b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, clip, want] of PASTED)
		it(`${mode}: ${name} pasted on a quote's bare blank line`, async () => {
			expect(await put('> a\n>\n>‸\n> b\n', mode, clip)).toBe(want);
		});
