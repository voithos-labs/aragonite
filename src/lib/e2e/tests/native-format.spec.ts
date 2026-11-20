import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { edgeKey } from '../platform-keys';

// The browser's own formatting shortcut on a key the editor doesn't bind.
// Requirements: e2e/requirements/native-format.md.

const selected = (page: EditorPage['page']) =>
	page.evaluate(() => window.getSelection()?.toString() ?? '');

async function selectFirstWord(page: EditorPage['page'], block: string): Promise<void> {
	await page.locator(block).first().click();
	await page.keyboard.press(edgeKey('lineStart'));
	for (let i = 0; i < 'hello'.length; i++) await page.keyboard.press('Shift+ArrowRight');
	expect(await selected(page)).toBe('hello');
}

test.describe('the browser’s own underline on a selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+U in a paragraph keeps the selection, and Ctrl+B then bolds it', async ({ page }) => {
		const source = 'hello world\n';
		await editor.loadContent(source);
		await selectFirstWord(page, '.text-editable-block');
		await page.keyboard.press('ControlOrMeta+u');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toBe(source);
		expect(await selected(page)).toBe('hello');
		await page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('**hello**');
	});

	test('Ctrl+U in a code block keeps the selection', async ({ page }) => {
		const source = '```\nhello world\n```\n';
		await editor.loadContent(source);
		await selectFirstWord(page, '.code-block');
		await page.keyboard.press('ControlOrMeta+u');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toBe(source);
		expect(await selected(page)).toBe('hello');
	});
});
