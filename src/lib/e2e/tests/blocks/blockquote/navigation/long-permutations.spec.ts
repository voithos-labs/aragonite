import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('blockquote navigation — long permutations', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('sequence of unrelated edits does not break final navigation', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.typeText(' extra');
		await editor.bridge.waitForSourceContains(' extra');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(4);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Z2$/m);
		expect(await editor.bridge.getSource()).toMatch(/^> Z2$/m);
	});
});
