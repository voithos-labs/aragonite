import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../editor-page';

// The fixture fails a spec whose page asks a host other than the app server
// (`requirements/fixture-off-host.md`). Each probe's request settles, so only teardown can fail it.

const OFF_HOST = 'https://e2e-off-host.test';
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>';

/** Loads `src` into a detached image, resolving with which of its two events fired. */
function loadImage(page: Page, src: string): Promise<'load' | 'error'> {
	return page.evaluate(
		(url) =>
			new Promise<'load' | 'error'>((resolve) => {
				const img = new Image();
				img.onload = () => resolve('load');
				img.onerror = () => resolve('error');
				img.src = url;
			}),
		src
	);
}

test.describe('the e2e fixture blocks requests to other hosts', () => {
	test.beforeEach(async ({ page }) => {
		await new EditorPage(page).goto();
	});

	test('an image from another host fails the spec', async ({ page }) => {
		test.fail();
		expect(await loadImage(page, `${OFF_HOST}/probe.svg`), 'the request is blocked').toBe('error');
	});

	test('a fetch to another host fails the spec', async ({ page }) => {
		test.fail();
		await page.evaluate((url) => fetch(url).catch(() => null), `${OFF_HOST}/probe.json`);
	});

	test("a new tab's page from another host fails the spec", async ({ page }) => {
		test.fail();
		// Firefox never loads a blocked tab's document, so the wait is for the block itself.
		const blocked = page
			.context()
			.waitForEvent('requestfailed', (request) => request.url().startsWith(OFF_HOST));
		await page.evaluate((url) => window.open(url, '_blank'), `${OFF_HOST}/tab`);
		await blocked;
	});

	test('a request for a host the spec answers itself passes', async ({ page }) => {
		await page
			.context()
			.route(`${OFF_HOST}/**`, (route) =>
				route.fulfill({ contentType: 'image/svg+xml', body: PICTURE })
			);
		expect(await loadImage(page, `${OFF_HOST}/probe.svg`)).toBe('load');
	});
});
