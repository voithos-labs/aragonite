import { test } from '../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../editor-page';

// An error event with no thrown value, the shape Chromium gives a ResizeObserver loop: it reaches
// `window.onerror` and never Playwright's `pageerror`.
const MESSAGE = 'injected onerror-only failure';
const THROWN = 'injected claimed throw';

async function throwUncaught(page: Page, message: string): Promise<void> {
	await new EditorPage(page).goto();
	await page.evaluate(
		(text) =>
			new Promise<void>((resolve) => {
				setTimeout(() => {
					setTimeout(resolve, 50);
					throw new Error(text);
				}, 0);
			}),
		message
	);
}

async function raiseOnerrorOnly(page: Page): Promise<void> {
	await new EditorPage(page).goto();
	await page.evaluate(
		(message) => window.dispatchEvent(new ErrorEvent('error', { message })),
		MESSAGE
	);
}

test.describe('the e2e fixture watches uncaught errors', () => {
	test('an uncaught thrown error fails the spec', async ({ page }) => {
		test.fail();
		await throwUncaught(page, 'injected uncaught throw');
	});

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

	test.describe('claimed thrown', () => {
		test.use({ expectPageErrors: [THROWN] });

		test('a claimed uncaught thrown error passes', async ({ page }) => {
			await throwUncaught(page, THROWN);
		});
	});
});
