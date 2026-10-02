import { test } from '../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../editor-page';

// An error event with no thrown value, the shape Chromium gives a ResizeObserver loop: it reaches
// `window.onerror` and never Playwright's `pageerror`.
const MESSAGE = 'injected onerror-only failure';

async function raiseOnerrorOnly(page: Page): Promise<void> {
	await new EditorPage(page).goto();
	await page.evaluate(
		(message) => window.dispatchEvent(new ErrorEvent('error', { message })),
		MESSAGE
	);
}

test.describe('the e2e fixture watches window.onerror', () => {
	test('an unclaimed onerror-only error fails the spec', async ({ page }) => {
		test.fail();
		await raiseOnerrorOnly(page);
	});

	test.describe('claimed', () => {
		test.use({ expectPageErrors: [MESSAGE] });

		test('a claimed onerror-only error passes, and the claim requires it to fire', async ({
			page
		}) => {
			await raiseOnerrorOnly(page);
		});
	});
});
