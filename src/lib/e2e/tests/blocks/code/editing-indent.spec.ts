import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('code block tab / indent', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab with no selection inserts a literal tab', async ({ page }) => {
		await editor.loadContent('```\nhello\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await page.keyboard.press('Tab');
		await editor.bridge.waitForSourceContains('hel\tlo');
	});

	test('Tab with multi-line selection indents every covered line', async ({ page }) => {
		await editor.loadContent('```\nline1\nline2\nline3\n```\n');
		await editor.getBlock(0).click();

		await editor.focusBlock(0, 4);
		for (let i = 0; i < 11; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}

		await page.keyboard.press('Tab');
		await editor.bridge.waitForSourceContains('\tline1');

		const source = await editor.bridge.getSource();
		expect(source).toContain('\tline2');
		expect(source).toMatch(/^line3$/m);
	});

	test('Shift+Tab removes leading tab from current line', async ({ page }) => {
		await editor.loadContent('```\n\tindented\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceNotContains('\tindented');
		expect(await editor.bridge.getSource()).toContain('indented');
	});

	test('Shift+Tab removes up to 4 leading spaces', async ({ page }) => {
		await editor.loadContent('```\n    spaced\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 9; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceNotContains('    spaced');
		expect(await editor.bridge.getSource()).toContain('spaced');
	});

	test('Shift+Tab is a no-op on a line with no leading whitespace', async ({ page }) => {
		await editor.loadContent('```\nline\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('ArrowRight');
		}
		const sourceBefore = await editor.bridge.getSource();
		await page.keyboard.press('Shift+Tab');
		// The marker flushes any async edit Shift+Tab might trigger, so the no-op assertion can't
		// pass vacuously.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');
		const sourceAfter = (await editor.bridge.getSource()).replace('X', '');
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('Shift+Tab with multi-line selection dedents every covered line', async ({ page }) => {
		await editor.loadContent('```\n\tline1\n\tline2\nline3\n```\n');
		await editor.getBlock(0).click();

		await editor.focusBlock(0, 4);
		for (let i = 0; i < 18; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}

		await page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceNotContains('\tline1');

		const source = await editor.bridge.getSource();
		expect(source).toContain('line1');
		expect(source).toContain('line2');
		expect(source).not.toContain('\tline2');
		expect(source).toContain('line3');
	});
});
