import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { enterPresentationMode } from './helpers';
import { URL_FIELD, commitUrl, openCardOn } from './link-card-helpers';

// The card over links that do not live in a top-level paragraph.
// Requirements: e2e/requirements/presentation/live-link-card-containers.md.

const DOC = [
	'| col |',
	'| --- |',
	'| see [alpha](https://one.test) |',
	'',
	'- outer',
	'  - nested [beta](https://two.test)'
].join('\n');

const enterLive = (page: Page) => enterPresentationMode(page, 'live', DOC);

test.describe('live-mode link card — inside containers', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('a link in a table cell opens the card and commits as one undo entry', async ({ page }) => {
		await openCardOn(ep, page, 'alpha');
		await expect(page.locator(URL_FIELD)).toHaveValue('https://one.test');

		await commitUrl(page, 'https://one.test/edited');

		await ep.bridge.waitForSourceContains('[alpha](https://one.test/edited)');
		expect(await ep.bridge.getSource()).toContain('| see [alpha](https://one.test/edited) |');

		await ep.undo();
		await ep.bridge.waitForSourceContains('[alpha](https://one.test)');
	});

	// The cell's own raw-write rule runs on the card's splice, so a pipe in a destination cannot
	// cut the row in half — the rung the shared commit primitive climbed.
	test('a pipe-bearing destination is escaped by the cell’s own write rule', async ({ page }) => {
		await openCardOn(ep, page, 'alpha');

		await commitUrl(page, 'https://one.test/a|b');

		await ep.bridge.waitForSourceContains('https://one.test/a\\|b');
		expect(await ep.bridge.getSource()).toContain('| see [alpha](https://one.test/a\\|b) |');
		// The construct survived the escape: an unescaped pipe would have cut the cell in half and
		// left the tail as literal text with no anchor at all.
		const anchor = page.locator("[role='cell'] a.md-link-content");
		await expect(anchor).toHaveText('alpha');
		// The href is the parsed destination, percent-encoded at the render sink — the escape the
		// cell added is a SOURCE byte and never reaches it.
		await expect(anchor).toHaveAttribute('href', 'https://one.test/a%7Cb');
		expect(await ep.parseConverged()).toBe(true);
	});

	test('remove-link in a table cell unwraps to the text and leaves the row whole', async ({
		page
	}) => {
		await openCardOn(ep, page, 'alpha');

		await page.getByRole('button', { name: 'Remove link' }).click();

		await ep.bridge.waitForSourceContains('| see alpha |');
		expect(await ep.bridge.getSource()).not.toContain('[alpha]');
	});

	test('a link in a nested list item opens the card and commits through the container ceremony', async ({
		page
	}) => {
		await openCardOn(ep, page, 'beta');
		await expect(page.locator(URL_FIELD)).toHaveValue('https://two.test');

		await commitUrl(page, 'https://two.test/edited');

		await ep.bridge.waitForSourceContains('[beta](https://two.test/edited)');
		expect(await ep.bridge.getSource()).toContain('  - nested [beta](https://two.test/edited)');

		await ep.undo();
		await ep.bridge.waitForSourceContains('[beta](https://two.test)');
	});
});
