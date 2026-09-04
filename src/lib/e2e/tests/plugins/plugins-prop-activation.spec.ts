import { test, expect } from '../../fixtures';

// Two editors over one seed: the first lists the parrot kind and the block-badge decoration
// source, the second lists neither. Definitions are process-global, so the difference is
// activation alone — the `plugins` prop is the enablement set
// (requirements/plugins/plugins-prop-activation.md). Degrading to raw IS the no-component
// fallback, which reports itself on the way past, so every load of this route warns once.
test.describe('the plugins prop is the enablement set', () => {
	test.use({ expectWarns: ['block-host'] });

	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/activation');
		await page.getByTestId('editor-listing').locator('[data-block-kind]').first().waitFor();
		await page.getByTestId('editor-not-listing').locator('[data-block-kind]').first().waitFor();
	});

	test('the listing editor renders the plugin component and its decorations', async ({ page }) => {
		const pane = page.getByTestId('editor-listing');
		await expect(pane.locator('[data-block-kind="parrot"] .parrot-block')).toBeVisible();
		await expect(pane.locator('[data-block-kind="parrot"] .raw-block')).toHaveCount(0);
		await expect(pane.locator('[data-block-kind="heading"] .badge-h')).toHaveCount(1);
	});

	test('degrades the unlisted kind to raw-editable', async ({ page }) => {
		const parrot = page.getByTestId('editor-not-listing').locator('[data-block-kind="parrot"]');
		await expect(parrot).toBeVisible();
		await expect(parrot.locator('.raw-block')).toBeVisible();
		await expect(parrot.locator('.parrot-block')).toHaveCount(0);
		await expect(parrot).toHaveText(/%%parrot party responsibly/);
	});

	// The badge rides an onEditor hook, so its absence is the hook never running here.
	test('attaches no decoration source from a plugin it did not list', async ({ page }) => {
		await expect(page.getByTestId('editor-not-listing').locator('.badge-h')).toHaveCount(0);
	});

	test('built-ins are untouched — both editors render their heading and body', async ({ page }) => {
		for (const testId of ['editor-listing', 'editor-not-listing']) {
			const pane = page.getByTestId(testId);
			await expect(pane.locator('[data-block-kind="heading"]')).toHaveCount(1);
			await expect(pane.locator('[data-block-kind="paragraph"]')).toHaveCount(1);
		}
	});
});
