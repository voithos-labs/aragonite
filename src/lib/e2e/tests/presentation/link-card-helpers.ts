import { expect, type Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { textRunCenter } from '../../text-runs';
import { clickInPlace } from '../../click-in-place';

// The link card's selectors and the gestures that open and commit it.

export const CARD = '[data-link-card]';
export const URL_FIELD = `${CARD} input[aria-label="Link URL"]`;
export const TEXT_FIELD = `${CARD} input[aria-label="Link text"]`;

/** A real click on the rendered link text, the only gesture that opens the card. */
export async function clickLink(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await textRunCenter(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
}

export async function openCardOn(ep: EditorPage, page: Page, word: string): Promise<void> {
	await clickLink(ep, page, word);
	await expect(page.locator(CARD)).toBeVisible();
}

/** Step into the card's field the way a user does; the caret stays in the document until then. */
export async function editUrl(page: Page, url: string): Promise<void> {
	await clickInPlace(page.locator(URL_FIELD));
	await expect(page.locator(URL_FIELD)).toBeFocused();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type(url);
}

export async function commitUrl(page: Page, url: string): Promise<void> {
	await editUrl(page, url);
	await page.keyboard.press('Enter');
}
