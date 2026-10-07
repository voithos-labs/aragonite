// @vitest-environment jsdom
// A write that changes a selected image's bytes while its toolbar stays open (a replace-all from the
// find bar) reseeds the toolbar, so its alt field shows the new alt and an edit builds on it.
// Miss-analysis: the only spec that wrote under an open toolbar was an undo, which now closes it,
// so no test wrote while the toolbar stayed up.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	destroyMountedEditors
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchKey } from '#lib/test/harness/settle.js';
import { mountImageSelected } from '../selection/image-selected-harness';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('the image toolbar under a replace-all', () => {
	it('shows the replaced alt, and an edit to it keeps the replacement', async () => {
		const h = await mountImageSelected('![cat](x.png)\n\nabc\n', { searchBar: true });
		const search = h.editor.instance.getSearch();
		search.open();
		search.setQuery('cat');
		search.setReplacement('dog');
		await search.replaceAll();
		await h.editor.settle();
		expect(h.overlayMounted()).toBe(true);

		const toolbar = h.editor.target.querySelector('.md-image-properties')!;
		toolbar.querySelector<HTMLButtonElement>('button[aria-label="Alt text"]')!.click();
		await h.editor.settle();
		const field = toolbar.querySelector<HTMLInputElement>('input')!;
		expect(field.value).toBe('dog');

		field.value = 'dog!';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		dispatchKey(field, { key: 'Enter' });
		await h.editor.settle();

		expect(h.editor.source()).toBe('![dog!](x.png)\n\nabc\n');
	});
});
