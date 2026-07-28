import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('code block partial copy: literal clipboard', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+A copy of full code block preserves both fences verbatim', async () => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toBe('```\n1\n2\n```');
	});

	test('partial copy including opening fence preserves it on clipboard', async ({ page }) => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('```');
		expect(clip).toContain('1');
		expect(clip).toContain('2');
	});

	test('partial copy including closing fence preserves it on clipboard', async ({ page }) => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlock(0, 4);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('```');
		expect(clip).toContain('1');
		expect(clip).toContain('2');
	});

	test('lone-fence selection copies the fence literally', async ({ page }) => {
		await editor.loadContent('```\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toBe('```');
	});

	test('full code block copy, paste into another code block: outer fence bumps, body stays literal', async () => {
		await editor.loadContent('```\nhello\n```\n\n```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		// Caret between the second (empty) code block's fences.
		await editor.getBlock(1).click();
		await editor.focusBlockStart(1);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('````\n```\nhello\n```\n````');

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^```\nhello\n```$/m);
		expect(source).toContain('````\n```\nhello\n```\n````');
	});
});
