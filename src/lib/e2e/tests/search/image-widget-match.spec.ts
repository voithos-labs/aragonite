import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';

const findInput = (page: Page) => page.getByRole('textbox', { name: 'Find' });
const count = (page: Page) => page.locator('.search-count');
const overlays = (page: Page) => page.locator('.match-overlay');
const activeOverlays = (page: Page) => page.locator('.match-overlay-active');

async function openFind(editor: EditorPage) {
	await editor.clickBlock(0);
	await editor.page.keyboard.press(`${primaryModifier}+f`);
	await findInput(editor.page).waitFor({ state: 'visible' });
}

// An atomic image widget contributes 0 chars to textContent and carries its raw
// bytes via data-source-*. A match landing entirely inside the widget's source
// range (here in the alt text) used to collapse to a zero-width range and paint
// nothing; the highlight must now cover the widget's box.
test.describe('search — image-widget matches', () => {
	test('a match inside an image alt text paints a visible overlay over the widget', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('- ![a needle here|120](https://picsum.photos/seed/x/120/80)\n');
		await editor.waitForRenderFlush();

		await openFind(editor);
		await page.keyboard.type('needle');

		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		// Exactly one overlay, painted with real width over the widget — not the
		// zero-width sliver the collapsed range produced pre-fix (dropped upstream).
		// The `|120` width gives the widget a deterministic layout width whether or
		// not picsum loads, so width (not height, which an unloaded image leaves 0)
		// is the network-independent signal that the highlight covers the widget.
		await expect(overlays(page)).toHaveCount(1);
		const width = await overlays(page)
			.first()
			.evaluate((el) => el.getBoundingClientRect().width);
		expect(width).toBeGreaterThan(0);

		// The sole match is the active match, so its overlay carries the active tint.
		await expect(activeOverlays(page)).toHaveCount(1);
		const activeWidth = await activeOverlays(page)
			.first()
			.evaluate((el) => el.getBoundingClientRect().width);
		expect(activeWidth).toBeGreaterThan(0);
	});

	test('matches in the image URL seed also paint over the widget', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		// The needle lives only in the URL (inside the widget source range), nowhere
		// in textContent — exercises the same fully-inside-a-widget collapse.
		await editor.loadContent('- ![alt|120](https://picsum.photos/seed/needleseed/120/80)\n');
		await editor.waitForRenderFlush();

		await openFind(editor);
		await page.keyboard.type('needleseed');

		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		await expect(overlays(page)).toHaveCount(1);
		const width = await overlays(page)
			.first()
			.evaluate((el) => el.getBoundingClientRect().width);
		expect(width).toBeGreaterThan(0);
	});

	test('showcase: "list" counts 11 and matches #9/#10 inside the list image paint', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();

		await openFind(editor);
		await page.keyboard.type('list');
		await expect(count(page)).toHaveText(/1\s*\/\s*11/);

		// Matches #9 and #10 live inside the image in `- ![In a list|300](.../seed/aragonite-list/...)`.
		// Step to #9 and assert an overlay paints with width > 0.
		for (let i = 1; i < 9; i++) {
			await page.keyboard.press('Enter');
		}
		await expect(count(page)).toHaveText(/9\s*\/\s*11/);
		await editor.waitForRenderFlush();
		const widths = await overlays(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().width)
		);
		expect(widths.length).toBeGreaterThan(0);
		expect(widths.some((w) => w > 0)).toBe(true);
		await expect(activeOverlays(page)).toHaveCount(1);
	});
});
