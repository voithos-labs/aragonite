// @vitest-environment jsdom
// A range from a block taken whole to the end of a quote, an item or a quote in an item that keeps a
// block above it, mounted in both modes: a letter typed after a cut, or a key typed over the range,
// stands in a paragraph of its own in the container, and a cut then Mod+V puts the blocks back in
// it. Right under the block above, the start's line goes with its markers; under a blank line of
// the container it stays, emptied, and the paste gives the bytes back.
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
	'a paragraph': 'last',
	nothing: null
};

/** How the taken blocks stand under `above`, and whether the start's line then goes. */
const SPACINGS = { 'right under the block above': true, 'under a blank line': false };

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

// Miss-analysis (under a blank line): every row stood the taken blocks right under `above`, so none
// saw the line going there move a typed key out of an item and leave a paste back outside it.
describe('a range out of a container from a block taken whole', () => {
	for (const mode of MODES)
		for (const [wrap, w] of Object.entries(WRAPS))
			for (const [spacing, lineGoes] of Object.entries(SPACINGS))
				for (const [name, block] of Object.entries(AFTER)) {
					const tail = block === null ? '' : `\n${block}\n`;
					const kept = `intro\n\n${w.open}above\n`;
					const lead = lineGoes ? kept : `${kept}${w.blank}\n`;
					const source = `${lead}${w.next}# text\n${w.next}below\n${tail}`;
					const select = {
						anchor: { path: [...w.path, 1], offset: 0 },
						focus: { path: [...w.path, 2], offset: 5 }
					};
					const cut = lineGoes ? `${kept}${tail}` : `${lead}${w.next}\n${tail}`;
					const own = (text: string) => `${kept}${w.blank}\n${w.next}${text}\n${tail}`;
					const title = `${mode}: ${wrap}, ${spacing}, ${name} after`;

					it(`${title}, a cut then a letter`, async () => {
						const editor = mountCase(source, mode);
						await editor.settle();
						await placeRange(editor, select);
						await clipboardGesture(editor, 'cut', 'key');
						expect(editor.source()).toBe(cut);
						await pressHardwareKey(focused(), { key: 'x' });
						await editor.settle();
						expect(editor.source()).toBe(own('x'));
					});

					it(`${title}, a typed key`, async () => {
						const editor = mountCase(source, mode);
						await editor.settle();
						await placeRange(editor, select);
						await typeGesture(editor, { text: 'x', route: 'hardware key' });
						expect(editor.source()).toBe(own('x'));
					});

					it(`${title}, a cut then Mod+V`, async () => {
						const editor = mountCase(source, mode);
						await editor.settle();
						const blocks = blocksIn(editor);
						await placeRange(editor, select);
						const payload = await clipboardGesture(editor, 'cut', 'key');
						await pasteGesture(editor, payload, 'key');
						expect(blocksIn(editor)).toEqual(blocks);
						if (!lineGoes) expect(editor.source()).toBe(source);
					});
				}
});
