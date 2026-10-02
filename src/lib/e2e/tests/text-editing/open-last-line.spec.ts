import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A block added after a last line with no line break gets a line of its own, and a move keeps the
// file's missing final break (`requirements/text-editing/open-last-line.md`). The fixture fails
// on any dev warning, so a tree the reload reads differently fails the test too.

const MODES = ['source', 'live'] as const;

// Typing into the new block may give it an ending of its own, so the typed rows trim it.
const trimEnding = (source: string) => source.replace(/\r?\n$/, '');

test.describe('text editing, a last line with no line break', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		test(`Enter at the end of the last list item adds an item (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('- a\n- b');
			await editor.focusBlockAtPath([0, 1, 0], 0);
			await page.keyboard.press('End');
			await page.keyboard.press('Enter');
			await page.keyboard.type('c');

			await expect
				.poll(async () => trimEnding(await editor.bridge.getSource()))
				.toBe('- a\n- b\n- c');
			await editor.waitForListItemCount(3);
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`ArrowDown past the last line adds a paragraph (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('one');
			await editor.focusBlockStart(0);
			await page.keyboard.press('End');
			await page.keyboard.press('ArrowDown');
			await page.keyboard.type('x');

			await expect.poll(async () => trimEnding(await editor.bridge.getSource())).toBe('one\n\nx');
			expect(await editor.bridge.getBlockCount()).toBe(2);
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`a click on the row below the last line adds a paragraph (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('one');
			await page.locator('.editor-tail-row').click();
			await page.keyboard.type('x');

			await expect.poll(async () => trimEnding(await editor.bridge.getSource())).toBe('one\n\nx');
			expect(await editor.bridge.getBlockCount()).toBe(2);
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`moving the last block up keeps the missing final break (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('a\n\n# b');
			await editor.focusBlockStart(1);
			await page.keyboard.press('Alt+ArrowUp');

			await editor.bridge.waitForSourceEquals('# b\n\na');
			expect(await editor.parseConverged()).toBe(true);
		});
	}
});
