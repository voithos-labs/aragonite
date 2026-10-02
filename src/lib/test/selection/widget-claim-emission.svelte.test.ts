// @vitest-environment jsdom
// How many `selectionChange` events each move into or out of a selected image sends, counted on
// the public channel. Selecting announces once, an image deselected alone stays silent, and the
// selection that replaces it announces itself once.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	destroyMountedEditors,
	pressKeyAt
} from '$lib/test/harness/mount-editor.svelte';
import { mountImageSelected } from './image-selected-harness';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// An image, a paragraph, then a table and a fence, which a gap caret sits between.
const SOURCE = '![a](x.png)\n\nabc\n\n| a |\n| - |\n| b |\n\n```\nc\n```\n';

describe('selectionChange around a selected image', () => {
	it('selecting the image announces once', async () => {
		const h = await mountImageSelected(SOURCE, {}, { select: false });

		await h.selectImage();

		expect(h.seen).toHaveLength(1);
	});

	// A right-button press on the root ends the image and places nothing.
	it('the image ending alone announces nothing', async () => {
		const h = await mountImageSelected(SOURCE);
		const root = h.editor.target.querySelector('.editor')!;

		root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
		await h.editor.settle();

		expect(h.overlayMounted()).toBe(false);
		expect(h.seen).toEqual([]);
	});

	it('setSelection announces once', async () => {
		const h = await mountImageSelected(SOURCE);

		await h.editor.instance.setSelection({
			anchor: { path: [1], offset: 1 },
			focus: { path: [1], offset: 1 }
		});
		await h.editor.settle();

		expect(h.seen).toHaveLength(1);
	});

	it('a gap caret placed announces once', async () => {
		const h = await mountImageSelected(SOURCE);

		await pressKeyAt(h.editor, [3], 0, { key: 'ArrowUp' });

		expect(h.editor.instance.__test.getGapCaret()).toEqual({ parentPath: [], index: 3 });
		expect(h.seen).toHaveLength(1);
	});

	it('a cross-block range entered announces once', async () => {
		const h = await mountImageSelected(SOURCE);

		await h.editor.instance.setSelection({
			anchor: { path: [1], offset: 0 },
			focus: { path: [3], offset: 1 }
		});
		await h.editor.settle();

		expect(h.editor.instance.__test.isCrossBlockActive()).toBe(true);
		expect(h.seen).toHaveLength(1);
	});
});
