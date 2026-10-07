import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Requirements: `e2e/requirements/text-editing/container-untouched-lines.md`.

const MODES = ['source', 'live'] as const;

test.describe('text editing, an edit inside a quote or list leaves its other lines alone', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		test(`typing in a quote leaves a sibling line’s bare marker (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('> a\n>b\n');
			await editor.clickBlockAtPath([0, 0], 0);
			await page.keyboard.press('End');

			await page.keyboard.type('Q');

			await expect.poll(() => editor.bridge.getSource()).toBe('> aQ\n>b\n');
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`typing on a line after a bare marker keeps the marker bare (${mode})`, async ({
			page
		}) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('>a\n');
			await editor.clickBlockAtPath([0, 0], 0);
			await page.keyboard.press('End');

			await page.keyboard.type('Q');

			await expect.poll(() => editor.bridge.getSource()).toBe('>aQ\n');
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`Enter in a list item keeps the tab of a line it moves (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('- ab\n\n\tc\n');
			await editor.clickBlockAtPath([0, 0, 0], 0);
			await page.keyboard.press('Home');
			await page.keyboard.press('ArrowRight');

			await page.keyboard.press('Enter');

			await expect.poll(() => editor.bridge.getSource()).toBe('- a\n- b\n\n\tc\n');
			expect(await editor.parseConverged()).toBe(true);
		});
	}

	test('a list marker typed at a lazy line’s start gives the line the quote’s prefix', async ({
		page
	}) => {
		await editor.loadContent('> a\nlazy\n');
		await editor.clickBlockAtPath([0, 0], 0);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Home');

		await page.keyboard.type('- ');

		await expect.poll(() => editor.bridge.getSource()).toBe('> a\n> - lazy\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('a heading typed over a lazy line’s paragraph leaves the line bare', async ({ page }) => {
		await editor.loadContent('- a\nlazy\n');
		await editor.clickBlockAtPath([0, 0, 0], 0);
		await page.keyboard.press('Home');

		await page.keyboard.type('# ');

		await expect.poll(() => editor.bridge.getSource()).toBe('- # a\nlazy\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.parseConverged()).toBe(true);
	});
});
