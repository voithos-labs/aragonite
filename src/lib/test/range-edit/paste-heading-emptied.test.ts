// @vitest-environment jsdom
// A clipboard of line endings alone over a heading's whole text: the heading gives way, its line
// stays empty, and the caret goes to the line under it, as Enter on the emptied heading leaves it.
// A second ending adds nothing, as Enter there only stacks a line. No dev check fires.
// In a list item each ending is the item's Enter, as over a paragraph in the heading's place.
// Miss-analysis: the endings-alone rows stood at carets, never over a range that empties a block;
// and the heading rows stood in no item, no indented container and no CRLF file, where the line
// under took the first line's markers (an item's own, read back as `-Z`) or a byte of the ending.
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

/** A key paste of `clip` over `⟦…⟧`: the bytes, then the bytes once `Z` is typed, no dev check. */
async function landed(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace(/[⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const [from, to] = [marked.indexOf('⟦'), marked.indexOf('⟧') - 1];
	const range = { anchor: pointAtByte(doc, from)!, focus: pointAtByte(doc, to)! };
	expect(await placeRange(editor, range)).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	const left = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return [left, typed];
}

const ROWS: [name: string, marked: string, left: string, typed: string][] = [
	['an ATX heading', '# ⟦Title⟧\n\nAfter\n', '\n\nAfter\n', '\nZ\n\nAfter\n'],
	['an ATX heading with a closing run', '# ⟦Title⟧ #\n\nAfter\n', '\n\nAfter\n', '\nZ\n\nAfter\n'],
	['a setext heading', '⟦Title⟧\n===\n\nAfter\n', '\n\nAfter\n', '\nZ\n\nAfter\n'],
	['a heading in a quote', '> # ⟦Title⟧\n>\n> After\n', '>\n>\n> After\n', '>\n> Z\n>\n> After\n'],
	['the last heading', 'Top\n\n# ⟦Title⟧\n', 'Top\n\n\n\n', 'Top\n\n\nZ\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, left, typed] of ROWS)
		for (const clip of ['\n', '\n\n'])
			it(`${mode}: ${JSON.stringify(clip)} over ${name}'s whole text: it gives way`, async () => {
				expect(await landed(marked, mode, clip)).toEqual([left, typed]);
			});

// One ending: the line under takes the markers a later line of its container takes.
const UNDER: [name: string, marked: string, left: string, typed: string][] = [
	[
		'a heading in a crlf file',
		'alpha\r\n\r\n# ⟦Title⟧\r\n\r\nAfter\r\n',
		'alpha\r\n\r\n\r\n\r\nAfter\r\n',
		'alpha\r\n\r\n\r\nZ\r\n\r\nAfter\r\n'
	],
	[
		'a heading in a footnote',
		'[^1]: note\n\n    # ⟦Title⟧\n\nAfter\n',
		'[^1]: note\n\n    \n    \n\nAfter\n',
		'[^1]: note\n\n    \n    Z\n\nAfter\n'
	],
	[
		'a heading in a quote an item holds',
		'- > # ⟦Title⟧\n- b\n',
		'- >\n  >\n- b\n',
		'- >\n  > Z\n- b\n'
	],
	[
		'a heading right under a title row',
		':::note\n# ⟦Title⟧\n\ntext\n:::\n',
		':::note\n\n\n\ntext\n:::\n',
		':::note\n\n\nZ\n\ntext\n:::\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, left, typed] of UNDER)
		it(`${mode}: a line ending over ${name}'s whole text`, async () => {
			expect(await landed(marked, mode, '\n')).toEqual([left, typed]);
		});

// [name, the document around an item's own block]
const ITEMS: [string, (block: string) => string][] = [
	['an item', (b) => `- a\n- ${b}\n- b\n`],
	['the only item', (b) => `- ${b}\n`],
	['an item holding more', (b) => `- a\n- ${b}\n\n  more\n- b\n`],
	['an item, as its second block', (b) => `- a\n\n  ${b}\n\n  more\n- b\n`],
	['an ordered item', (b) => `1. a\n2. ${b}\n3. b\n`],
	['a nested item', (b) => `- a\n  - x\n  - ${b}\n- b\n`],
	['an item in a quote', (b) => `> - a\n> - ${b}\n> - b\n`],
	['an item in a crlf file', (b) => `- a\r\n- ${b}\r\n- b\r\n`]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, host] of ITEMS)
		for (const clip of ['\n', '\n\n'])
			it(`${mode}: ${JSON.stringify(clip)} over a heading in ${name}, as over a paragraph`, async () => {
				const twin = await landed(host('⟦beta⟧'), mode, clip);
				expect(await landed(host('# ⟦Title⟧'), mode, clip)).toEqual(twin);
			});

it('an item whose heading gave way: the ending leaves the list, as Enter there', async () => {
	const typed = '- a\n\nZ\n\n- b\n';
	expect(await landed('- a\n- # ⟦Title⟧\n- b\n', 'live', '\n')).toEqual(['- a\n\n\n- b\n', typed]);
});
