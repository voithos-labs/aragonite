import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickInPlace } from '../../click-in-place';
import { clickWordSettled, enterPresentationMode, landAt, nextRow } from './helpers';
import { CARD, TEXT_FIELD, URL_FIELD, editUrl, openCardOn } from './link-card-helpers';

// The link card's Text field, above the URL, for edit and create.
// Requirements: e2e/requirements/presentation/live-link-card-text.md.

const U = 'https://example.com';

/** Step into the Text field the way a user does and replace what it holds. */
async function editText(page: Page, text: string): Promise<void> {
	await clickInPlace(page.locator(TEXT_FIELD));
	await expect(page.locator(TEXT_FIELD)).toBeFocused();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Backspace');
	await page.keyboard.type(text);
}

async function undoOnce(ep: EditorPage, page: Page): Promise<void> {
	await page.keyboard.press('ControlOrMeta+z');
	await ep.waitForRenderFlush();
}

test.describe('live-mode link card: the Text field', () => {
	test('shows the link’s text above the URL, and Enter writes a new one, spaces and all', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', `Visit [example](${U}) now`);
		await openCardOn(ep, page, 'example');
		await expect(page.locator(TEXT_FIELD)).toHaveValue('example');
		const [text, url] = await Promise.all(
			[TEXT_FIELD, URL_FIELD].map(async (field) => (await page.locator(field).boundingBox())!.y)
		);
		expect(text).toBeLessThan(url);

		await editText(page, 'my new link');
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceEquals(`Visit [my new link](${U}) now`);
		await expect(page.locator(CARD)).toHaveCount(0);
	});

	test('text and URL changed together are one undo step', async ({ page }) => {
		const doc = `Visit [example](${U}) now`;
		const ep = await enterPresentationMode(page, 'live', doc);
		await openCardOn(ep, page, 'example');
		await editText(page, 'site');
		await editUrl(page, 'https://other.test/');
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceEquals('Visit [site](https://other.test/) now');
		await undoOnce(ep, page);
		expect(await ep.bridge.getSource()).toBe(doc);
	});

	test('characters that would end the link or format it stay the text you typed', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', `Visit [example](${U}) now`);
		await openCardOn(ep, page, 'example');
		await editText(page, 'a]b(c)|*d*');
		await page.keyboard.press('Enter');
		await expect(page.locator('.md-link-content').first()).toHaveText('a]b(c)|*d*', {
			useInnerText: true
		});
		expect((await ep.bridge.getSource()).endsWith(`](${U}) now`)).toBe(true);
	});

	test('an emptied field refuses Enter, and the card stays open', async ({ page }) => {
		const doc = `Visit [example](${U}) now`;
		const ep = await enterPresentationMode(page, 'live', doc);
		await openCardOn(ep, page, 'example');
		await editText(page, '');
		await page.keyboard.press('Enter');
		await expect(page.locator(CARD)).toBeVisible();
		expect(await ep.bridge.getSource()).toBe(doc);
	});

	test('formatted text shows read-only, and a URL edit still writes', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', `Visit [**bold** text](${U}) now`);
		await openCardOn(ep, page, 'text');
		await expect(page.locator(TEXT_FIELD)).toHaveValue('bold text');
		await expect(page.locator(TEXT_FIELD)).toHaveAttribute('readonly', '');
		await editUrl(page, 'https://other.test/');
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceEquals('Visit [**bold** text](https://other.test/) now');
	});

	test('a full reference keeps its label; the collapsed and shortcut forms spell it out', async ({
		page
	}) => {
		const def = `\n\n[example]: ${U}`;
		const ep = await enterPresentationMode(page, 'live', `Visit [example][example] now${def}`);
		for (const form of ['[example][example]', '[example][]', '[example]']) {
			await nextRow(ep, `Visit ${form} now${def}`);
			await openCardOn(ep, page, 'example');
			await editText(page, 'the site');
			await page.keyboard.press('Enter');
			await ep.bridge.waitForSourceEquals(`Visit [the site][example] now${def}`);
		}
	});
});

test.describe('live-mode link card: the Text field when creating', () => {
	test('starts from the selection, and a changed text replaces it in one write', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', 'Alpha bravo charlie');
		await clickWordSettled(ep, page, 'Alpha');
		await landAt(ep, page, 6);
		for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
		await ep.pressDeclined('ControlOrMeta+k');
		await expect(page.locator(TEXT_FIELD)).toHaveValue('bravo');
		await page.keyboard.type('https://new.test/');
		await editText(page, 'delta echo');
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceEquals('Alpha [delta echo](https://new.test/) charlie');
		await undoOnce(ep, page);
		expect(await ep.bridge.getSource()).toBe('Alpha bravo charlie');
	});
});
