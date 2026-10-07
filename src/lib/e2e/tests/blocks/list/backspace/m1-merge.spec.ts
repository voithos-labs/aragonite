import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { getContainerParityMismatches } from '../../../../container-parity';
import { capturePageErrors } from '../../../../page-probes';

// The worked examples (rows 2 to 5) and the ordered renumber are pinned in
// `merge-list-item.test.ts` and `merge-keeps-lines.test.ts`.
test.describe('list Backspace: M1 merge on non-first item', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at start of non-empty non-first item merges into previous item (rule B: deepest visible above)', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const betaItem = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await betaItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		// Byte-exact: equality pins the surviving single marker the way a count cannot.
		await editor.bridge.waitForSourceEquals('- AlphaBeta\n');

		// The caret lands at the merge point, so the next key goes between the two texts.
		await editor.typeText('Z');
		await editor.bridge.waitForSourceEquals('- AlphaZBeta\n');
	});

	test('M1 row 6: indented code under the merged item keeps its blank line', async () => {
		await editor.loadContent('- a\n- b\n\n      code\n');
		await editor.focusBlockAtPath([0, 1, 0], 1);
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('- ab\n\n      code\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	// `children` extended without `childIds` gives the trailing keyed-each entries undefined keys,
	// which Svelte reports as `each_key_duplicate`, hence the console watch below.
	test('M1 keeps children/childIds parity at every depth (rows 3+4 shape)', async ({ page }) => {
		const consoleErrors: string[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text());
		});
		const pageErrors = capturePageErrors(page);

		await editor.loadContent('- A\n  - B\n    - C\n- D\n  - E\n');
		const dItem = editor.page.locator('[contenteditable="true"]', { hasText: 'D' }).first();
		await dItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^ {4}- CD/m);

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
		expect(consoleErrors.filter((m) => /each_key_duplicate/.test(m))).toEqual([]);
	});

	test('M1 opaque previous leaf (fenced code): no merge, no crash, caret falls back', async ({
		page
	}) => {
		// Backspace after a fenced-code-only item must change no structure and move the caret into
		// the code block; a throw inside the commit crashes in dev and does nothing in production.
		const pageErrors = capturePageErrors(page);

		await editor.loadContent('- ```\n  code\n  ```\n- text\n');
		const textItem = editor.page.locator('[contenteditable="true"]', { hasText: 'text' }).first();
		await textItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.waitForRenderFlush();

		const source = await editor.bridge.getSource();
		expect(source).toContain('code');
		expect(source).toContain('text');
		// No merge: both items survive, and 'text' is not appended to the code block.
		expect((source.match(/^- /gm) ?? []).length).toBe(2);
		expect(source).not.toContain('codetext');
		expect(pageErrors).toEqual([]);
	});

	test('ordered: deleting item renumbers subsequent', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForListItemCount(4);
		// The new empty item pushes Third to 4; without pinning that, the
		// post-Backspace `3. Third` is just the document as loaded.
		await editor.bridge.waitForSourceMatches(/^4\. Third$/m);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/3\.\s*Third/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/1\.\s*First/);
		expect(source).toMatch(/2\.\s*Second/);
		expect(source).toMatch(/3\.\s*Third/);
	});
});
