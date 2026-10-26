import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { gotoReady, gotoUnhydrated, reloadReady } from '../goto-ready';

// The navigation helpers leave a page only once it has finished loading
// (`requirements/goto-ready.md`). The first page's images are held by resource type, so the rows
// hold wherever the harness serves its images from.

const HELD_FOR = 300;

const NAVIGATIONS: [string, (page: Page) => Promise<void>][] = [
	['gotoReady', (page) => gotoReady(page, '/test/editor?header=on')],
	['reloadReady', (page) => reloadReady(page)],
	['gotoUnhydrated', (page) => gotoUnhydrated(page, '/test/editor?header=on')]
];

for (const [name, navigate] of NAVIGATIONS) {
	test(`${name} lets the page it leaves finish loading its images first`, async ({ page }) => {
		const order: string[] = [];
		let answer!: () => void;
		const answered = new Promise<void>((resolve) => (answer = resolve));
		await page.route('**/*', async (route) => {
			if (route.request().resourceType() === 'image') await answered;
			await route.fallback();
		});
		await gotoReady(page, '/test/editor');
		const loading = await page.evaluate(() => [...document.images].some((img) => !img.complete));
		expect(loading, 'the first page holds an image still loading').toBe(true);

		page.on('request', (request) => {
			if (request.isNavigationRequest()) order.push('next page requested');
		});
		const navigation = navigate(page);
		// A slow image server: the next page may be requested only after this answer.
		setTimeout(() => {
			order.push('images answered');
			answer();
		}, HELD_FOR);
		await navigation;

		expect(order[0], 'the next page went out before the old page finished loading').toBe(
			'images answered'
		);
	});
}
