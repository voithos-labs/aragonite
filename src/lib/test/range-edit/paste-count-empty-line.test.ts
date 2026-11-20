// @vitest-environment jsdom
// A paste's `edit` event counts the blocks it landed as, and text counts 0 (ruling 43): one paragraph
// pasted on an empty line went in as text wherever the line is, between blocks or ending the file,
// in a container or an item, its last line ending or not, and so does one over a range it takes
// the place of. A block of another kind counts.
// Miss-analysis: the count was pinned where the caret held text, and an empty line between blocks
// reads as no block's text, so the clipboard's read as one paragraph was counted as a block.
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

/** The `edit` events a paste of `clip` at `‸` or over `⟦ ⟧` fires, by op and detail. */
async function edits(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const from = marked.search(/[‸⟦]/);
	const to = marked.includes('⟧') ? marked.indexOf('⟧') - 1 : from;
	const [anchor, focus] = [pointAtByte(doc, from)!, pointAtByte(doc, to)!];
	expect(await placeRange(editor, { anchor, focus })).toBe(true);
	const seen: unknown[] = [];
	editor.instance.getEvents().on('edit', (e) => seen.push({ op: e.op, detail: e.detail }));
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return seen;
}

const EMPTY_LINES: [string, string][] = [
	['between paragraphs', 'alpha\n\n‸\n\ngamma\n'],
	['over a paragraph', 'alpha\n\n‸\ngamma\n'],
	['ending the file', 'alpha\n\n‸\n'],
	['in a quote', '> a\n>\n> ‸\n>\n> b\n'],
	['in an empty item', '- a\n- ‸\n- b\n'],
	['in an item', '- a\n\n  ‸\n\n  b\n'],
	['in a callout', ':::note\na\n\n‸\n\nb\n:::\n'],
	['in a CRLF file', 'alpha\r\n\r\n‸\r\n\r\ngamma\r\n']
];

// [the clipboard, the count]
const CLIPS: [string, number][] = [
	['xy', 0],
	['x\ny', 0],
	['xy\n', 0],
	['x\n\ny', 2],
	['# h', 1]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of EMPTY_LINES)
		for (const [clip, count] of CLIPS)
			it(`${mode}: ${JSON.stringify(clip)} on an empty line ${name} counts ${count}`, async () => {
				expect(await edits(marked, mode, clip)).toEqual([{ op: 'paste', detail: { count } }]);
			});

// Source mode holds these blocks whole; the paste takes their place as typed text does, after the
// removal's own `delete` where the range crosses blocks.
const RANGES: [string, string][] = [
	['a heading held whole', 'alpha\n\n⟦# head⟧\n\nb\n'],
	['a fence held whole', 'alpha\n\n⟦```\ncode\n```⟧\n\nb\n'],
	['two whole paragraphs', 'alpha\n\n⟦beta\n\ngamma⟧\n\nb\n'],
	['a heading held whole in a quote', '> a\n>\n> ⟦# head⟧\n>\n> b\n']
];

for (const [name, marked] of RANGES)
	for (const [clip, count] of CLIPS)
		it(`source: ${JSON.stringify(clip)} over ${name} counts ${count}`, async () => {
			expect((await edits(marked, 'source', clip)).at(-1)).toEqual({
				op: 'paste',
				detail: { count }
			});
		});
