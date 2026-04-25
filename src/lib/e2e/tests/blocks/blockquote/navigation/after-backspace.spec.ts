import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../../editor-page';

test.describe('blockquote navigation — after Backspace (delete empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Delete empty middle paragraph, then ArrowDown crosses the gap', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 200ms — Enter splits paragraph; empty middle isn't visible in source.
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Backspace');
		// wait 200ms — Backspace removes the empty middle; transient state not observable via source.
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> [2Z]+$/m);
		expect(await editor.bridge.getSource()).toMatch(/^> [2Z]+$/m);
	});
});
