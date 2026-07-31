import { test, expect } from '../../fixtures';

// Two editors share one process-global memo registration; the left disables the memo kind through
// its registry view. Both parse the memo syntax to a memo CST node (global grammar at load), but
// only the enabled editor resolves a component for it — the disabled one degrades to the
// raw-editable fallback.
test.describe('per-instance registry enablement', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/enablement');
		await page.getByTestId('editor-disabled').locator('[data-block-kind]').first().waitFor();
		await page.getByTestId('editor-enabled').locator('[data-block-kind]').first().waitFor();
	});

	test('the disabled instance degrades the memo block to raw-editable', async ({ page }) => {
		const disabledMemo = page.getByTestId('editor-disabled').locator('[data-block-kind="memo"]');
		await expect(disabledMemo).toBeVisible();
		// The unknown-kind fallback surface, not the memo component.
		await expect(disabledMemo.locator('.raw-block')).toBeVisible();
		await expect(disabledMemo.locator('.memo-block')).toHaveCount(0);
		await expect(disabledMemo).toHaveText(/%% memo text/);
	});

	test('the enabled instance renders the memo component', async ({ page }) => {
		const enabledMemo = page.getByTestId('editor-enabled').locator('[data-block-kind="memo"]');
		await expect(enabledMemo).toBeVisible();
		// The plugin component, no fallback.
		await expect(enabledMemo.locator('.memo-block')).toBeVisible();
		await expect(enabledMemo.locator('.raw-block')).toHaveCount(0);
	});

	test('built-ins are untouched — both editors render their paragraphs', async ({ page }) => {
		for (const testId of ['editor-disabled', 'editor-enabled']) {
			const paragraphs = page.getByTestId(testId).locator('[data-block-kind="paragraph"]');
			// `Before` and `After` around the memo block.
			await expect(paragraphs).toHaveCount(2);
		}
	});
});
