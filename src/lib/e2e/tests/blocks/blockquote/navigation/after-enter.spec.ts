import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('blockquote navigation — after Enter (empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of inner paragraph, then ArrowDown from empty paragraph reaches next paragraph', async () => {
		// The empty middle is built by a real Enter, not loaded: the regression this guards
		// is the split's own re-render, which a loaded document never runs.
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Z2$/m);
		expect(await editor.bridge.getSource()).toMatch(/^> Z2$/m);
	});

	test('Enter at end of inner paragraph, then ArrowUp from empty paragraph reaches previous paragraph', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Z1$/m);
		expect(await editor.bridge.getSource()).toMatch(/^> Z1$/m);
	});
});
