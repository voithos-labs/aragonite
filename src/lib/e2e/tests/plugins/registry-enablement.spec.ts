import { test, expect } from '../../fixtures';

// Two editors share one memo registration for the whole process, and the left one turns the memo
// kind off through its own view of the registry. Each parses the seed in its own grammar, so only
// the editor that has it on holds a memo block; the other reads the same bytes as a paragraph.
test.describe('per-instance registry enablement', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/enablement');
		await page.getByTestId('editor-disabled').locator('[data-block-kind]').first().waitFor();
		await page.getByTestId('editor-enabled').locator('[data-block-kind]').first().waitFor();
	});

	test('the disabled instance reads the memo syntax as a paragraph', async ({ page }) => {
		const pane = page.getByTestId('editor-disabled');
		await expect(pane.locator('[data-block-kind="memo"]')).toHaveCount(0);
		await expect(pane.locator('[data-block-kind="paragraph"]').nth(1)).toHaveText(/%% memo text/);
	});

	test('the enabled instance renders the memo component', async ({ page }) => {
		const enabledMemo = page.getByTestId('editor-enabled').locator('[data-block-kind="memo"]');
		await expect(enabledMemo).toBeVisible();
		// The plugin component, no fallback.
		await expect(enabledMemo.locator('.memo-block')).toBeVisible();
		await expect(enabledMemo.locator('.raw-block')).toHaveCount(0);
	});

	test('built-ins are untouched: both editors render their paragraphs', async ({ page }) => {
		for (const testId of ['editor-disabled', 'editor-enabled']) {
			const paragraphs = page.getByTestId(testId).locator('[data-block-kind="paragraph"]');
			await expect(paragraphs.first()).toHaveText('Before');
			await expect(paragraphs.last()).toHaveText('After');
		}
	});
});
