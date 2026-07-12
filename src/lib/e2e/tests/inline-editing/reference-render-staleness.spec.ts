import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const SOURCE = `See [click][go].

[go]: https://old.com
`;

test.describe('inline editing — reference render staleness', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SOURCE);
	});

	test('reference block renders the LRD target on load', async () => {
		const link = editor.getBlock(0).locator('a.md-link-content');
		await expect(link).toHaveCount(1);
		await expect(link).toHaveAttribute('href', 'https://old.com');
	});

	test('editing only the LRD URL re-renders an unedited reference block href', async () => {
		// Block 1 is the LRD: `[go]: https://old.com`. Place the caret at end of
		// the line, select back over `old.com`, and retype `new.com` — a real
		// user edit that never touches block 0.
		const lrdLine = '[go]: https://old.com';
		await editor.focusBlock(1, lrdLine.length);
		for (let i = 0; i < 'old.com'.length; i++) {
			await editor.page.keyboard.press('Shift+ArrowLeft');
		}
		await editor.page.keyboard.type('new.com');
		await editor.bridge.waitForSourceContains('https://new.com');
		await editor.waitForRenderFlush();

		const link = editor.getBlock(0).locator('a.md-link-content');
		await expect(link).toHaveCount(1);
		await expect(link).toHaveAttribute('href', 'https://new.com');
	});

	test('removing the LRD reverts the unedited reference block to plain text', async () => {
		const lrdLine = '[go]: https://old.com';
		await editor.focusBlock(1, lrdLine.length);
		await editor.page.keyboard.press('Shift+Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('https://old.com');
		await editor.waitForRenderFlush();

		await expect(editor.getBlock(0).locator('a.md-link-content')).toHaveCount(0);
	});
});
