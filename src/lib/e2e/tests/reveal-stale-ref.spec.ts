import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// A top-level list position holding a reference to a component that is no longer in the page
// must be dropped and the block mounted again, not descended into. The stale reference is
// planted on purpose, because the cleanup race that leaves one behind cannot be reproduced
// on demand.
test.describe('reveal into a stale top-level ref slot', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+F reveal drops the stale slot and lands on the match', async ({ page }) => {
		const fillers = Array.from({ length: 2500 }, (_, i) => `filler paragraph ${i}`).join('\n\n');
		await editor.loadContent(`- zebrafish target item\n- second item\n\n${fillers}\n`);

		expect(await page.evaluate(() => (window as any).__test.captureBlockRef(0))).toBe(true);

		// Scroll far past the list, so block 0 unmounts and its list position clears.
		await editor.scrollEditorTo(10_000_000);
		await expect(page.locator(`[data-block-path='[0]']`)).toHaveCount(0);
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getBlockCursorSurface([0]).exists))
			.toBe(false);

		// Plant the stale reference: the captured one now points at a component no longer in
		// the page.
		expect(await page.evaluate(() => (window as any).__test.replantBlockRef(0))).toBe(true);

		// A search scrolls to the first list item's unique text.
		await page.keyboard.press('ControlOrMeta+f');
		await page.getByRole('textbox', { name: 'Find' }).waitFor({ state: 'visible' });
		await page.keyboard.type('zebrafish');

		// Scrolling to the match must drop the stale reference, scroll back up and mount the
		// list with the match highlighted, not quietly do nothing.
		await expect(page.locator(`[data-block-path='[0]']`)).toHaveCount(1);
		await expect(page.locator('.match-overlay-active')).toBeVisible();
	});
});
