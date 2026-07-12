import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('blocked-scheme links are inert', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a javascript: link renders inert (no anchor) and does not navigate', async ({
		context
	}) => {
		await editor.loadContent('Click [x](javascript:alert(1)) now.\n');
		await expect(editor.page.locator('a.md-link-content')).toHaveCount(0);
		const blocked = editor.page.locator('span.md-link-blocked', { hasText: 'x' });
		await expect(blocked).toHaveCount(1);

		let popupFired = false;
		context.on('page', () => {
			popupFired = true;
		});
		await blocked.click({ modifiers: ['Control'] });
		await editor.page.waitForTimeout(200); // absence-of-popup check; no state to predicate on
		expect(popupFired).toBe(false);
	});
});
