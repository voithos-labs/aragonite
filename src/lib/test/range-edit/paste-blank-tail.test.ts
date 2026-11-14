// @vitest-environment jsdom
// A clipboard's trailing line of only spaces or tabs is a blank line, so it is a line ending: the
// paste leaves what the same clipboard with bare line endings leaves, its spaces unwritten, and a
// letter typed next lands the same. Spaces that follow no line ending are text, a hard break's two
// spaces stay, and literal text takes every byte as written.
// Miss-analysis: the ending rows drew bare line endings only, so no row asked what a trailing line
// copied with its indent is.
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

/** A key paste of `clip` at `‸`: the bytes, the caret, then the bytes once `Z` is typed. */
async function landed(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	const left = editor.source();
	const caret = editor.instance.getSelection()?.focus;
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return { left, caret, typed };
}

const HOSTS: [name: string, marked: string][] = [
	['a paragraph’s end', 'alpha‸\n\nAfter\n'],
	['mid-text', 'al‸pha\n\nAfter\n'],
	['an item’s end', '- list‸\n- next\n'],
	['mid-item', '- li‸st\n- next\n'],
	['a quote', '> alpha‸\n\nAfter\n'],
	['a to-do', '- [ ] alpha‸\n- [ ] beta\n'],
	['a CRLF item', '- list‸\r\n- next\r\n']
];

/** Each clipboard beside the one with bare line endings it reads as. */
const TAILS: [name: string, clip: string, bare: string][] = [
	['a space', 'xy\n \n', 'xy\n\n'],
	['a tab', 'xy\n\t\n', 'xy\n\n'],
	['several lines', 'xy\n  \n\t\n', 'xy\n\n\n'],
	['spaces past the last ending', 'xy\n  ', 'xy\n'],
	['a list', '- one\n- two\n  \n', '- one\n- two\n\n'],
	['CRLF', 'xy\r\n \r\n', 'xy\r\n\r\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [host, marked] of HOSTS)
		for (const [tail, clip, bare] of TAILS)
			it(`${mode}: ${tail} at ${host} is a line ending`, async () => {
				expect(await landed(marked, mode, clip)).toEqual(await landed(marked, mode, bare));
			});

/** Bytes the trailing rule leaves alone, `‸` where the next letter lands: spaces that follow no
 *  line ending, a blank line with text after it, a hard break, and literal text. */
const KEPT: [name: string, marked: string, clip: string, left: string][] = [
	['a space mid-text', 'al‸pha\n\nAfter\n', ' ', 'al ‸pha\n\nAfter\n'],
	['a space at a paragraph’s end', 'alpha‸\n\nAfter\n', ' ', 'alpha ‸\n\nAfter\n'],
	['spaces mid-item', '- li‸st\n- next\n', '  ', '- li  ‸st\n- next\n'],
	['a tab at an item’s end', '- list‸\n- next\n', '\t', '- list\t‸\n- next\n'],
	['a space mid-quote', '> al‸pha\n\nAfter\n', ' ', '> al ‸pha\n\nAfter\n'],
	['a space at a heading’s end', '# Title‸\n\nAfter\n', ' ', '# Title ‸\n\nAfter\n'],
	[
		'a blank line with text after it',
		'al‸pha\n\nAfter\n',
		'xy\n \nzz',
		'alxy\n \nzz‸pha\n\nAfter\n'
	],
	['a hard break', 'al‸pha\n\nAfter\n', 'xy  \nzz', 'alxy  \nzz‸pha\n\nAfter\n'],
	['a code block', '```\nco‸de\n```\n', 'xy\n \n', '```\ncoxy\n \n‸de\n```\n'],
	['indented code', 'para\n\n    co‸de\n', 'xy\n \n', 'para\n\n    coxy\n     \n    ‸de\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, left] of KEPT)
		it(`${mode}: ${name} goes in as written`, async () => {
			const { left: bytes, typed } = await landed(marked, mode, clip);
			expect([bytes, typed]).toEqual([left.replace('‸', ''), left.replace('‸', 'Z')]);
		});

/** Enter at `‸`, then `Z`: the bytes and caret Enter leaves, and the letter after. */
async function pressed(marked: string, mode: PresentationMode) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Enter' });
	await editor.settle();
	const left = editor.source();
	const caret = editor.instance.getSelection()?.focus;
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	await destroyMountedEditors();
	return { left, caret, typed };
}

// A line ending pasted alone in an empty item is Enter there, which takes the item out of its list.
// Miss-analysis: the endings-alone rows stood in paragraphs and quotes, never an empty item.
const EMPTY_ITEMS: [name: string, marked: string][] = [
	['an empty bullet', '- a\n- ‸\n- b\n'],
	['the last empty bullet', '- a\n- ‸\n'],
	['an empty ordered item', '1. a\n2. ‸\n3. b\n'],
	['an empty to-do', '- [ ] a\n- [ ] ‸\n'],
	['an empty item in a quote', '> - a\n> - ‸\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of EMPTY_ITEMS)
		it(`${mode}: a line ending alone in ${name} is Enter`, async () => {
			expect(await landed(marked, mode, '\n')).toEqual(await pressed(marked, mode));
		});
