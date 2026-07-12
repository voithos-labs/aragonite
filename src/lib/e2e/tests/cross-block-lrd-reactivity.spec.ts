import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('cross-block LRD reactivity', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('an LRD edit in one block re-resolves references in another', async ({ page }) => {
		await editor.loadContent('see [docs][d]\n\nplaceholder\n');

		const block0 = editor.getBlock(0);
		await expect(block0.locator('span.md-unresolved-ref')).toHaveCount(1);
		await expect(block0.locator('a.md-link-content')).toHaveCount(0);

		// Replace block 1's text with an LRD — a real user edit that never
		// touches block 0 but changes the LRD signature.
		await editor.focusBlockEnd(1);
		await page.keyboard.press('Shift+Home');
		await page.keyboard.type('[d]: https://example.com');
		await editor.bridge.waitForSourceContains('[d]: https://example.com');

		const link = block0.locator('a.md-link-content');
		await expect(link).toHaveCount(1);
		await expect(link).toHaveAttribute('href', 'https://example.com');
		await expect(block0.locator('span.md-unresolved-ref')).toHaveCount(0);
	});
});
