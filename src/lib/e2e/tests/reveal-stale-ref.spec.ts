import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { primaryModifier } from '../platform';

// A top-level slot holding a DETACHED off-window ref must be dropped and re-revealed, not
// descended into. The stale slot is forged deterministically because the natural cleanup
// race that leaves one behind is not reproducible on demand.
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

		// Scroll far past the list: block 0 windows out and its slot clears.
		await editor.scrollEditorTo(10_000_000);
		await expect(page.locator(`[data-block-path='[0]']`)).toHaveCount(0);
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getBlockCursorSurface([0]).exists))
			.toBe(false);

		// Forge the stale slot: the captured ref is now a detached container shim.
		expect(await page.evaluate(() => (window as any).__test.replantBlockRef(0))).toBe(true);

		// Search-driven reveal into the first list item's unique text.
		await page.keyboard.press(`${primaryModifier}+f`);
		await page.getByRole('textbox', { name: 'Find' }).waitFor({ state: 'visible' });
		await page.keyboard.type('zebrafish');

		// The reveal must drop the stale ref, scroll back up, and mount the list
		// with a visible match overlay — not silently no-op on the detached shim.
		await expect(page.locator(`[data-block-path='[0]']`)).toHaveCount(1);
		await expect(page.locator('.match-overlay-active')).toBeVisible();
	});
});
