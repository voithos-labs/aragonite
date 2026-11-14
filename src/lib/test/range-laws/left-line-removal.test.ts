// @vitest-environment jsdom
// A range from a block taken whole to the end of a quote, an item or a quote in an item that keeps a
// block above it, mounted in both modes: the start's line goes with its markers, so a letter typed
// after a cut, or a key typed over the range, stands in a paragraph of its own in the container,
// and a cut then Mod+V puts the blocks back in it.
// Miss-analysis: the mounted rows took a container's last blocks from its first block or from the
// top level, so none kept a block above the emptied marker line a letter there joins.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import {
	blocksIn,
	clipboardGesture,
	mountCase,
	pasteGesture,
	placeRange,
	typeGesture
} from './gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['source', 'live'];

/** Each container's opening markers, its next lines' markers, its blank line, and its path. */
const WRAPS = {
	'a quote': { open: '> ', next: '> ', blank: '>', path: [1] },
	'an item': { open: '- ', next: '  ', blank: '', path: [1, 0] },
	'a quote in an item': { open: '- > ', next: '  > ', blank: '  >', path: [1, 0, 0] }
};
/** What follows the container; none where it ends the document. */
const AFTER = {
	'a fence': '```\nlast\n```',
	'a math block': '$$\nm\n$$',
	'a rule': '***',
	'a tip': ':::tip\nbody\n:::',
	'a heading': '# h',
	'a table': '| a |\n|---|\n| 1 |',
	nothing: null
};

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

describe('a range out of a container from a block taken whole', () => {
	for (const mode of MODES)
		for (const [wrap, w] of Object.entries(WRAPS))
			for (const [name, block] of Object.entries(AFTER)) {
				const tail = block === null ? '' : `\n${block}\n`;
				const source = `intro\n\n${w.open}above\n${w.next}# text\n${w.next}below\n${tail}`;
				const select = {
					anchor: { path: [...w.path, 1], offset: 0 },
					focus: { path: [...w.path, 2], offset: 5 }
				};
				const own = (text: string) =>
					`intro\n\n${w.open}above\n${w.blank}\n${w.next}${text}\n${tail}`;

				it(`${mode}: ${wrap}, ${name} after, a cut then a letter`, async () => {
					const editor = mountCase(source, mode);
					await editor.settle();
					await placeRange(editor, select);
					await clipboardGesture(editor, 'cut', 'key');
					expect(editor.source()).toBe(`intro\n\n${w.open}above\n${tail}`);
					await pressHardwareKey(focused(), { key: 'x' });
					await editor.settle();
					expect(editor.source()).toBe(own('x'));
				});

				it(`${mode}: ${wrap}, ${name} after, a typed key`, async () => {
					const editor = mountCase(source, mode);
					await editor.settle();
					await placeRange(editor, select);
					await typeGesture(editor, { text: 'x', route: 'hardware key' });
					expect(editor.source()).toBe(own('x'));
				});

				it(`${mode}: ${wrap}, ${name} after, a cut then Mod+V`, async () => {
					const editor = mountCase(source, mode);
					await editor.settle();
					const blocks = blocksIn(editor);
					await placeRange(editor, select);
					const payload = await clipboardGesture(editor, 'cut', 'key');
					await pasteGesture(editor, payload, 'key');
					expect(blocksIn(editor)).toEqual(blocks);
				});
			}
});
