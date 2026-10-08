// @vitest-environment jsdom
// A selected image outlives the routes that put a stored selection back after a detour: a
// presentation-mode switch and the find bar opening and closing.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import {
	installLayoutStubs,
	destroyMountedEditors,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchKey } from '#lib/test/harness/settle.js';
import { mountImageSelected, type ImageSelected } from './image-selected-harness';
import { caretAt } from '#lib/test/harness/editor-selection.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const SOURCE = '![a](x.png)\n\nabc\n';

function expectImageStillSelected(h: ImageSelected): void {
	expect(h.overlayMounted()).toBe(true);
	expect(h.editor.instance.getSelection()).toEqual(caretAt([0], 0));
	expect(document.activeElement).toBe(surfaceAt(h.editor, [0]));
}

describe('a selected image across a round trip', () => {
	it('stays selected, its paragraph focused, across a source to live switch', async () => {
		const h = await mountImageSelected(SOURCE, { presentationMode: 'source' });

		h.editor.props.presentationMode = 'live';
		flushSync();
		await h.editor.settle();

		expectImageStillSelected(h);
	});

	it('stays selected when the find bar opens and Escape closes it', async () => {
		const h = await mountImageSelected(SOURCE, { searchBar: true });

		dispatchKey(surfaceAt(h.editor, [0]), { key: 'f', ctrlKey: true });
		await h.editor.settle();
		const field = document.activeElement;
		expect(field?.tagName).toBe('INPUT');
		dispatchKey(field!, { key: 'Escape' });
		await h.editor.settle();

		expectImageStillSelected(h);
		expect(h.seen).toHaveLength(1);
	});
});
