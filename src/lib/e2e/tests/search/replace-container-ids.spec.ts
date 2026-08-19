import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Replace All must not reparse a top-level subtree WITHOUT childIds: a reused container
// component fed the fresh node renders `undefined` keys, and a list item with two or more
// children then collides on the duplicate key and throws.
test.describe('search — replace preserves container ids', () => {
	test('Replace All over "list" never desyncs nested container ids', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto(); // HARNESS_SHOWCASE_CONTENT by default — do not loadContent

		await page.evaluate(() => (window as any).__test.startErrorCapture());

		await editor.clickBlock(0);
		await page.keyboard.press('ControlOrMeta+h');
		const replaceInput = page.getByRole('textbox', { name: 'Replace' });
		await replaceInput.waitFor({ state: 'visible' });

		await page.getByRole('textbox', { name: 'Find' }).click();
		await page.keyboard.type('list');
		await replaceInput.fill('love');
		// Wait for the scan to count matches before triggering the batch replace.
		await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*\d+/);

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('love');
		await editor.waitForRenderFlush();

		// No block threw on render: the error-event capture stays empty.
		const errors = await page.evaluate(() => (window as any).__test.getCapturedErrors());
		expect(errors).toEqual([]);

		// Every nested container's BlockListState tracks its children 1:1.
		const violations = await page.evaluate(() =>
			(window as any).__test.auditBlockListStateConsistency()
		);
		expect(violations).toEqual([]);

		await expect(page.locator('[data-failed-block]')).toHaveCount(0);

		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});
});
