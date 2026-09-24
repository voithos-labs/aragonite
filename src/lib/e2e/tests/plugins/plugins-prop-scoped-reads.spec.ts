import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';

type Pane = 'listing' | 'notListing';

const sourceOf = (page: Page, pane: Pane) =>
	page.evaluate(
		(p) =>
			(window as unknown as { __activation: { source(pane: Pane): string } }).__activation.source(
				p
			),
		pane
	);

// The `?reads` variant of the two-editor page, in live mode: the first editor lists emoji and
// latex, the second lists neither, and both list the toc
// (requirements/plugins/plugins-prop-scoped-reads.md).
test.describe('checks and plugin reads follow the plugins prop', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/activation?reads');
		await page.getByTestId('editor-not-listing').locator('[data-block-kind]').first().waitFor();
		await page.waitForFunction(() => '__activation' in window);
	});

	test('Mod+K over a shortcode the editor draws as text opens the link card', async ({ page }) => {
		const pane = page.getByTestId('editor-not-listing');
		await pane.locator('[data-block-kind="paragraph"]').filter({ hasText: 'smile' }).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('ControlOrMeta+k');

		await expect(page.locator('[data-link-card]')).toBeVisible();
	});

	test('a pending bold typed inside dollars the editor draws as text lands bold', async ({
		page
	}) => {
		const pane = page.getByTestId('editor-not-listing');
		await pane.locator('[data-block-kind="paragraph"]').filter({ hasText: '$' }).click();
		await page.keyboard.press('Home');
		for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ControlOrMeta+b');
		await page.keyboard.type('y');

		await expect.poll(() => sourceOf(page, 'notListing')).toContain('\n\na $x**y**$ b\n');
	});
});

test.describe('a plugin reads inline syntax the way its editor draws it', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/activation?reads');
		await page.getByTestId('editor-not-listing').locator('.toc-block-item').first().waitFor();
	});

	test('the toc label reads the dollars as text only in the editor without latex', async ({
		page
	}) => {
		const labelIn = (testId: string) => page.getByTestId(testId).locator('.toc-block-item').first();
		await expect(labelIn('editor-not-listing')).toHaveText('Title $x$');
		await expect(labelIn('editor-listing')).toHaveText('Title $*x*$');
	});
});
