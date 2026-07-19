import { test, expect } from '../../fixtures';

// The `/` showcase's presentation-mode toggle. No `window.__test` bridge on this
// route — rendered-DOM assertions only, like showcase-route.spec.ts.
// Requirements: e2e/requirements/presentation/presentation-showcase.md.

test.describe('/ showcase presentation toggle', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.block-host').first()).toBeVisible();
	});

	test('reading hides markers, keeps rendered widgets; source restores', async ({ page }) => {
		const editor = page.locator('.editor');
		const marker = page.locator('.text-editable-block .md-marker').first();
		await expect(marker).toBeVisible();

		await page.locator('.showcase-mode[data-mode="reading"]').click();
		await expect(editor).toHaveAttribute('data-presentation', 'reading');
		await expect(marker).toBeHidden();
		// Rendered widgets survive the flip.
		await expect(page.locator('.katex').first()).toBeVisible();
		await expect(page.locator('.mermaid-block').first()).toBeVisible();

		await page.locator('.showcase-mode[data-mode="source"]').click();
		await expect(editor).not.toHaveAttribute('data-presentation');
		await expect(marker).toBeVisible();
	});
});
