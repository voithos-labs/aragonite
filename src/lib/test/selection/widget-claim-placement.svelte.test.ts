// @vitest-environment jsdom
// A caret, range or gap caret the editor puts down while an image is selected ends the image and
// is what `getSelection()` reads back.
// Miss-analysis: every image selection test ended the image by a click or a key on the image's
// own paragraph; none put a selection down through setSelection, undo, a block's focus or a gap.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	destroyMountedEditors,
	pressKeyAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchKey } from '#lib/test/harness/settle.js';
import { mountImageSelected } from './image-selected-harness';
import { caretAt } from '#lib/test/harness/editor-selection.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const SOURCE = '![a](x.png)\n\nabc\n';
const RANGE = { anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: 2 } };
// jsdom moves the caret to a block's start when the block takes focus, so a restored caret lands
// there; offset 0 in block 1 is still distinct from the image's own caret in block 0.
const RESTORED = caretAt([1], 0);

describe('a selection the editor puts down ends a selected image', () => {
	it('setSelection of a caret reads back as set, and the overlay goes', async () => {
		const h = await mountImageSelected(SOURCE);

		await h.editor.instance.setSelection(RESTORED);
		await h.editor.settle();

		expect(h.editor.instance.getSelection()).toEqual(RESTORED);
		expect(h.overlayMounted()).toBe(false);
		expect(h.seen).toEqual([RESTORED]);
	});

	// The block taking focus collapses the range too, so only the block is read back.
	it('setSelection of a range in one block lands in that block, and the overlay goes', async () => {
		const h = await mountImageSelected(SOURCE);

		await h.editor.instance.setSelection(RANGE);
		await h.editor.settle();

		expect(h.editor.instance.getSelection()?.focus.path).toEqual([1]);
		expect(h.overlayMounted()).toBe(false);
	});

	it('undo puts the caret back where the undone typing went', async () => {
		const h = await mountImageSelected(SOURCE, {}, { select: false });
		await h.editor.instance.setSelection(RESTORED);
		expect(await h.editor.instance.insertMarkdown('Z')).toBe(true);
		await h.selectImage();

		expect(h.editor.instance.runCommand('history.undo')).toBe(true);
		await h.editor.settle();

		expect(h.editor.source()).toBe(SOURCE);
		expect(h.editor.instance.getSelection()).toEqual(RESTORED);
		expect(h.overlayMounted()).toBe(false);
	});

	it('a block taking the caret through its focus announces the caret it took', async () => {
		const h = await mountImageSelected(SOURCE);

		h.editor.instance.__test.getBlockComponent([1])!.focus(1);
		await h.editor.settle();

		expect(h.seen).toEqual([caretAt([1], 1)]);
		expect(h.overlayMounted()).toBe(false);
	});

	it('a gap caret placed by an arrow key ends the image', async () => {
		const h = await mountImageSelected('![a](x.png)\n\n| a |\n| - |\n| b |\n\n```\nc\n```\n');

		await pressKeyAt(h.editor, [2], 0, { key: 'ArrowUp' });

		expect(h.editor.instance.__test.getGapCaret()).toEqual({ parentPath: [], index: 2 });
		expect(h.overlayMounted()).toBe(false);
		// The public read stays null at a gap caret.
		expect(h.seen).toEqual([null]);
	});
});

// Miss-analysis: the select-all tests started from a caret or a range, never from a selected image.
describe('a first Mod+A over a selected image', () => {
	it('selects the paragraph and ends the image', async () => {
		const h = await mountImageSelected('![c](x.png) two\n\nabc\n');

		dispatchKey(surfaceAt(h.editor, [0]), { key: 'a', ctrlKey: true });
		await h.editor.settle();

		const whole = { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 15 } };
		expect(h.editor.instance.getSelection()).toEqual(whole);
		expect(h.overlayMounted()).toBe(false);
		expect(h.seen).toEqual([whole]);
	});

	it("a block's setSelection ends the image too", async () => {
		const h = await mountImageSelected(SOURCE);

		h.editor.instance.__test.getBlockComponent([1])!.setSelection!(0, 2);
		await h.editor.settle();

		expect(h.overlayMounted()).toBe(false);
		expect(window.getSelection()?.toString()).toBe('ab');
	});
});

describe('with no image selected, the same calls', () => {
	it('setSelection of a caret reads back as set', async () => {
		const h = await mountImageSelected(SOURCE, {}, { select: false });

		await h.editor.instance.setSelection(RESTORED);
		await h.editor.settle();

		expect(h.editor.instance.getSelection()).toEqual(RESTORED);
		expect(h.seen).toEqual([RESTORED]);
	});

	it('a block taking the caret through its focus announces it', async () => {
		const h = await mountImageSelected(SOURCE, {}, { select: false });

		h.editor.instance.__test.getBlockComponent([1])!.focus(1);
		await h.editor.settle();

		expect(h.seen).toEqual([caretAt([1], 1)]);
	});
});
