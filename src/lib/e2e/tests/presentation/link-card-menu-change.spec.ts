import { test, expect } from '../../fixtures';
import { enterPresentationMode } from './helpers';
import { CARD, openCardOn } from './link-card-helpers';

// The live-mode link card is a popover over the document and reports on `menuChange` like the
// editor's menus. Requirements: `requirements/presentation/link-card-menu-change.md`.

test('the link card reads true when it opens and false when Escape closes it', async ({ page }) => {
	const ep = await enterPresentationMode(
		page,
		'live',
		'Visit [example](https://example.com) now\n'
	);
	await page.evaluate(() => (window as any).__test.startMenuChangeCapture());

	await openCardOn(ep, page, 'example');
	await page.keyboard.press('Escape');
	await expect(page.locator(CARD)).toHaveCount(0);

	expect(await page.evaluate(() => (window as any).__test.stopMenuChangeCapture())).toEqual([
		true,
		false
	]);
});
