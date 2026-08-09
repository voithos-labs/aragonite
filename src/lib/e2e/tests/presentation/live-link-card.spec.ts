import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { centerOfWord } from './helpers';

// The anchored chrome that replaces the destination live mode hides.
// Requirements: e2e/requirements/presentation/live-link-card.md.

const DOC = [
	'Visit [example](https://example.com) now',
	'',
	'Click [danger](javascript:alert(1)) here',
	'',
	'See <https://commonmark.org> too',
	'',
	'Read [docs][ref] later',
	'',
	'[ref]: https://example.com/docs'
].join('\n');

const CARD = '[data-link-card]';
const URL_FIELD = `${CARD} input`;

async function enterLive(page: Page): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto('?presentationMode=live');
	await ep.loadContent(DOC);
	await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
	return ep;
}

/** A real click on the rendered link text — the only gesture that opens the card. */
async function clickLink(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await centerOfWord(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
}

async function openCardOn(ep: EditorPage, page: Page, word: string): Promise<void> {
	await clickLink(ep, page, word);
	await expect(page.locator(CARD)).toBeVisible();
}

/** Step into the card's field the way a user does — the caret stays in the document until then. */
async function editUrl(page: Page, url: string): Promise<void> {
	await page.locator(URL_FIELD).click();
	await expect(page.locator(URL_FIELD)).toBeFocused();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type(url);
}

test.describe('live-mode link card', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('a click on a link opens an anchored dialog holding the hidden destination', async ({
		page
	}) => {
		await openCardOn(ep, page, 'example');

		const card = page.locator(CARD);
		await expect(card).toHaveAttribute('role', 'dialog');
		await expect(card).toHaveAttribute('aria-label', /link/i);
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com');

		// Anchored to the link's own box, not to a page corner.
		const linkBox = (await page.locator('a.md-link-content').first().boundingBox())!;
		const cardBox = (await card.boundingBox())!;
		expect(cardBox.y).toBeGreaterThanOrEqual(linkBox.y);
		expect(Math.abs(cardBox.x - linkBox.x)).toBeLessThan(60);
	});

	test('a blocked-scheme link renders as a span and still opens the card', async ({ page }) => {
		await expect(page.locator('span.md-link-blocked')).toHaveCount(1);
		await openCardOn(ep, page, 'danger');
		await expect(page.locator(URL_FIELD)).toHaveValue('javascript:alert(1)');
	});

	test('an autolink opens no card: its destination is the text already on screen', async ({
		page
	}) => {
		await expect(page.locator('a.md-autolink')).toHaveCount(1);
		await clickLink(ep, page, 'commonmark');
		await expect(page.locator(CARD)).toHaveCount(0);
	});

	test('the opening click leaves the caret in the document, so link TEXT stays editable', async ({
		page
	}) => {
		await openCardOn(ep, page, 'example');

		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([0]);
		await page.keyboard.type('!');
		await ep.bridge.waitForSourceMatches(/\[exam!?ple!?\]/);
	});

	test('Enter rewrites only the destination, as ONE undo entry', async ({ page }) => {
		await openCardOn(ep, page, 'example');

		await editUrl(page, 'https://elsewhere.test/x');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('[example](https://elsewhere.test/x)');
		await expect(page.locator(CARD)).toHaveCount(0);
		expect(await ep.bridge.getSource()).toContain('Visit [example](https://elsewhere.test/x) now');

		await ep.undo();
		await ep.bridge.waitForSourceContains('[example](https://example.com)');
	});

	test('Escape writes nothing and puts the caret back where the click seated it', async ({
		page
	}) => {
		const before = await ep.bridge.getSource();
		await openCardOn(ep, page, 'example');
		const seated = (await ep.bridge.getSelectionPaths())!.focus;
		await editUrl(page, 'https://never.test');

		await page.keyboard.press('Escape');

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
		await expect.poll(async () => (await ep.bridge.getSelectionPaths())?.focus).toEqual(seated);
	});

	test('remove-link leaves the text the reader was already seeing', async ({ page }) => {
		await openCardOn(ep, page, 'example');

		await page.getByRole('button', { name: 'Remove link' }).click();

		await ep.bridge.waitForSourceContains('Visit example now');
		expect(await ep.bridge.getSource()).not.toContain('[example]');
	});

	test('an edit landing elsewhere re-anchors the card instead of stranding it', async ({
		page
	}) => {
		await openCardOn(ep, page, 'docs');
		const beforeBox = (await page.locator(CARD).boundingBox())!;

		// An external source change is the one edit that lands while the card is open — a press in
		// the document dismisses it. The block STRUCTURE is unchanged, so the card's target still
		// names the same link; only the geometry under it moved.
		await page.evaluate(() => {
			const win = window as unknown as { __test: { setSource(md: string): void } };
			win.__test.setSource(
				[
					'Visit [example](https://example.com) now. ' + 'padding words '.repeat(60),
					'',
					'Click [danger](javascript:alert(1)) here',
					'',
					'See <https://commonmark.org> too',
					'',
					'Read [docs][ref] later',
					'',
					'[ref]: https://example.com/docs',
					''
				].join('\n')
			);
		});
		await ep.waitForRenderFlush();

		await expect(page.locator(CARD)).toBeVisible();
		await expect
			.poll(async () => (await page.locator(CARD).boundingBox())!.y)
			.toBeGreaterThan(beforeBox.y);
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com/docs');
	});

	test('a reference link’s URL edit inlines the destination and leaves the definition alone', async ({
		page
	}) => {
		await openCardOn(ep, page, 'docs');
		await expect(page.locator(URL_FIELD)).toHaveValue('https://example.com/docs');

		await editUrl(page, 'https://example.com/new');
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceContains('Read [docs](https://example.com/new) later');
		expect(await ep.bridge.getSource()).toContain('[ref]: https://example.com/docs');
	});

	test('a press outside closes the card without writing', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await openCardOn(ep, page, 'example');

		await ep.clickBlock(2);

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('open-link goes through the url policy, which refuses a blocked scheme', async ({
		context,
		page
	}) => {
		let popupFired = false;
		context.on('page', () => {
			popupFired = true;
		});
		await openCardOn(ep, page, 'danger');

		await page.getByRole('button', { name: 'Open link' }).click();

		// 200ms — verifying the ABSENCE of a popup, which has no observable state to predicate on.
		await page.waitForTimeout(200);
		expect(popupFired).toBe(false);
	});

	test('Tab is trapped once focus is inside the open card', async ({ page }) => {
		await openCardOn(ep, page, 'example');
		await page.locator(URL_FIELD).click();

		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Open link' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Remove link' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.locator(URL_FIELD)).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(page.getByRole('button', { name: 'Remove link' })).toBeFocused();
	});
});
