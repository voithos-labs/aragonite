import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { count, findInput, openFind, overlays, typeQuery } from './helpers';

/**
 * The find bar across a whole-document `source` swap
 * (requirements/search/source-swap-rescan.md). Search memoizes its scan on the
 * edit epoch, so a swap that leaves the epoch alone strands the counter on the
 * previous document's total and paints overlays over unmatched text.
 */

test.describe('search — an open find bar across a source swap', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha one\n\nalpha two\n\nalpha three\n');
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
		await expect(overlays(page)).toHaveCount(3);
	});

	test('a swap to a document with no matches clears the count and every overlay', async ({
		page
	}) => {
		await editor.loadContent('nothing matches now\n');
		await expect(count(page)).toHaveText(/No results/);
		await expect(overlays(page)).toHaveCount(0);
		await expect(findInput(page)).toHaveValue('alpha');
	});

	test('a swap to a document with fewer matches re-counts against the new document', async ({
		page
	}) => {
		await editor.loadContent('beta one\n\nalpha two\n');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		await expect(overlays(page)).toHaveCount(1);
	});
});
