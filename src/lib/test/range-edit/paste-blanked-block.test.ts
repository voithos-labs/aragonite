// @vitest-environment jsdom
// A space pasted over a block's whole text leaves the bytes the block's emptying write leaves, by
// either commit: the blank block stands for the blank line under it, which goes. G1.218 holds both.
// Miss-analysis: the block's own write hid the core's extra blank line until a paste stopped taking
// it, and no mounted row emptied a block by a paste with a block under it.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(destroyMountedEditors);

/** A block whose four letters of text the paste covers, and the commit that lands it there. */
const ROWS = [
	{ name: 'a paragraph, by its own write', doc: 'Plan\n\nnext\n', path: [0], out: ' \nnext\n' },
	{
		name: 'a setext title, by the splice',
		doc: 'Plan\n---\n\nnext\n',
		path: [0],
		out: ' \nnext\n'
	},
	{
		name: 'a title over ===, by the splice',
		doc: 'Plan\n===\n\nnext\n',
		path: [0],
		out: ' \nnext\n'
	},
	{
		name: 'a setext title in a quote, by the splice',
		doc: '> Plan\n> ---\n>\n> next\n',
		path: [0, 0],
		out: '>  \n> next\n'
	},
	{
		name: 'a callout’s first block, by the splice',
		doc: '> [!NOTE]\n> Plan\n>\n> next\n',
		path: [0, 0],
		out: '> [!NOTE]\n>\n>  \n> next\n'
	}
];

describe.each(['source', 'live'] as const)('in %s mode', (mode) => {
	it.each(ROWS)('$name', async ({ doc, path, out }) => {
		const editor = mountCase(doc, mode);
		await placeRange(editor, { anchor: { path, offset: 0 }, focus: { path, offset: 4 } });

		await pasteGesture(editor, { 'text/plain': ' ' }, 'key');

		expect(editor.source()).toBe(out);
	});
});

it('a live ATX heading’s whole text, by the splice', async () => {
	const editor = mountCase('# Plan\n\nnext\n', 'live');
	await placeRange(editor, { anchor: { path: [0], offset: 2 }, focus: { path: [0], offset: 6 } });

	await pasteGesture(editor, { 'text/plain': ' ' }, 'key');

	expect(editor.source()).toBe(' \nnext\n');
});
