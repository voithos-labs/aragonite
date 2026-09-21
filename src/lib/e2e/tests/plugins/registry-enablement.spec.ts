import { test, expect } from '../../fixtures';

// Two editors share one memo registration for the whole process, and the left one turns the memo
// kind off through its own view of the registry. Both parse the memo syntax into a memo node,
// since the grammar is shared at load, but only the editor that has it on resolves a component;
// the other falls back to editable raw text.
test.describe('per-instance registry enablement', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/enablement');
		await page.getByTestId('editor-disabled').locator('[data-block-kind]').first().waitFor();
		await page.getByTestId('editor-enabled').locator('[data-block-kind]').first().waitFor();
	});

	// Falling back to raw text is what happens with no component, and it warns on the way past.
	test.describe('the disabled instance', () => {
		test.use({ expectWarns: ['block-host'] });

		test('degrades the memo block to raw-editable', async ({ page }) => {
			const disabledMemo = page.getByTestId('editor-disabled').locator('[data-block-kind="memo"]');
			await expect(disabledMemo).toBeVisible();
			// The fallback for an unknown kind, not the memo component.
			await expect(disabledMemo.locator('.raw-block')).toBeVisible();
			await expect(disabledMemo.locator('.memo-block')).toHaveCount(0);
			await expect(disabledMemo).toHaveText(/%% memo text/);
		});
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
			// `Before` and `After` around the memo block.
			await expect(paragraphs).toHaveCount(2);
		}
	});
});
