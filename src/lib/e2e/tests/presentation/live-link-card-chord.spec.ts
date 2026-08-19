import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickWordSettled, enterPresentationMode } from './helpers';
import { CARD, URL_FIELD, openCardOn } from './link-card-helpers';

// Mod+K is a chord this editor claims, so every seat it can be pressed from consumes it.
// Requirements: e2e/requirements/presentation/live-link-card-chord.md.

const DOC = [
	'Visit [example](https://example.com) now',
	'',
	'plain words here',
	'',
	'```',
	'fenced',
	'```'
].join('\n');

/**
 * `defaultPrevented` read at a document BUBBLE listener, where every editor handler has already
 * run: `false` means the press reached the browser's own Mod+K defaults — Chrome's omnibox, and
 * on macOS the contenteditable kill-to-end-of-line the `Mod` fold routes here — on a chord
 * `reservedChords()` reports as consumed.
 */
async function modKConsumed(ep: EditorPage, page: Page): Promise<boolean | null> {
	await page.evaluate(() => {
		const probe = window as Window & { __modK?: { consumed: boolean | null } };
		if (!probe.__modK) {
			const slot: { consumed: boolean | null } = { consumed: null };
			probe.__modK = slot;
			document.addEventListener('keydown', (e) => {
				if (e.key === 'k' || e.key === 'K') slot.consumed = e.defaultPrevented;
			});
		}
		probe.__modK.consumed = null;
	});
	await page.keyboard.press('ControlOrMeta+k');
	await ep.waitForRenderFlush();
	return page.evaluate(
		() => (window as Window & { __modK?: { consumed: boolean | null } }).__modK?.consumed ?? null
	);
}

test.describe('live-mode link card — Mod+K is consumed wherever it is bound', () => {
	test('a caret outside every link consumes the press and opens no card', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.clickBlock(1);
		const before = await ep.bridge.getSource();

		expect(await modKConsumed(ep, page)).toBe(true);

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	// The same caret that ENTERS the card in live mode: source paints the destination already, so
	// the chord has nothing to do here — which is not the same as handing the key back.
	test('source mode consumes the press with the caret inside a link', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await clickWordSettled(ep, page, 'example');
		const before = await ep.bridge.getSource();

		expect(await modKConsumed(ep, page)).toBe(true);

		await expect(page.locator(CARD)).toHaveCount(0);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('a fenced code block consumes the press', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.clickBlock(2);
		const before = await ep.bridge.getSource();

		expect(await modKConsumed(ep, page)).toBe(true);

		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test("the open card's own URL field consumes the press", async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await openCardOn(ep, page, 'example');
		await page.locator(URL_FIELD).click();
		await expect(page.locator(URL_FIELD)).toBeFocused();

		expect(await modKConsumed(ep, page)).toBe(true);

		await expect(page.locator(CARD)).toBeVisible();
		await expect(page.locator(URL_FIELD)).toBeFocused();
	});
});
