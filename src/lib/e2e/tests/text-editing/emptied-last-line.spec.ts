import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Erasing a block's last line down to nothing leaves its line break standing, and the caret on
// the empty line after it: the next key belongs there, in every mode.

const MODES = ['source', 'live'] as const;

test.describe('text editing, a last line erased to nothing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		test(`the next key lands on the emptied line of a paragraph (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('Plan\nmore\n');
			await editor.focusBlockEnd(0);
			for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\n');
			await page.keyboard.type('x');

			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\nx\n');
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`the emptied line above a blank line keeps one blank line (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('Plan\nmore\n\nnext\n');
			await editor.focusBlockEnd(0);
			for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\nnext\n');
			expect(await editor.parseConverged()).toBe(true);

			await page.keyboard.press('Backspace');
			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\nnext\n');
			expect(await editor.bridge.getBlockCount()).toBe(2);
			expect(await editor.parseConverged()).toBe(true);
		});
	}

	// With no final line break, the emptied last paragraph is a blank last line, which keeps its
	// break, so the next key stands alone instead of joining the paragraph above.
	for (const [name, source, path, emptied, typed] of [
		['a paragraph under a blank line', 'Plan\n\nmore', [1], 'Plan\n\n\n', 'Plan\n\nx\n'],
		['a quote’s last paragraph', '> Plan\n>\n> more', [0, 1], '> Plan\n>\n>\n', '> Plan\n>\n> x\n']
	] as const)
		for (const mode of MODES)
			test(`no final line break: ${name} erased keeps its line (${mode})`, async ({ page }) => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(source);
				await editor.focusBlockAtPath([...path], 4);
				for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
				await expect.poll(() => editor.bridge.getSource()).toBe(emptied);
				await page.keyboard.type('x');

				await expect.poll(() => editor.bridge.getSource()).toBe(typed);
				expect(await editor.parseConverged()).toBe(true);
			});

	test('a setext underline erased above a blank line keeps one blank line (source)', async ({
		page
	}) => {
		await editor.setPresentationMode('source');
		await editor.loadContent('Plan\n===\n\nb\n');
		await editor.focusBlockEnd(0);
		for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');

		await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\nb\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});
