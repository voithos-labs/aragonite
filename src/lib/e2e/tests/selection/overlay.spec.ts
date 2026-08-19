import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('selection — overlay: happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('middle block overlay renders for strictly-between blocks', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await expect(
			editor.page.locator("[data-block-path='[1]'] .selection-overlay-middle").first()
		).toBeAttached();
	});

	test('single-block selection has no custom overlay divs', async () => {
		await editor.loadContent('one block here\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.waitForCrossBlock(false);
		await expect(editor.page.locator('.selection-overlay')).toHaveCount(0);
	});

	test('overlay disappears when selection collapses', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await expect(editor.page.locator('.selection-overlay').first()).toBeAttached();

		await editor.page.keyboard.press('ArrowLeft');
		await editor.waitForCrossBlock(false);

		await expect(editor.page.locator('.selection-overlay')).toHaveCount(0);
	});
});

test.describe('selection — overlay: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('overlay has pointer-events: none', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const pointerEvents = await editor.page.evaluate(() => {
			const el = document.querySelector('.selection-overlay');
			if (!el) return null;
			return getComputedStyle(el).pointerEvents;
		});
		expect(pointerEvents).toBe('none');
	});

	test('endpoint overlays appear on start and end blocks during drag', async () => {
		await editor.loadContent('aaa bbb\n\nccc\n\nddd eee\n');
		await editor.dragFromTo([0], 1, [2], 2);
		await expect(
			editor.page.locator("[data-block-path='[0]'] .selection-overlay-endpoint").first()
		).toBeAttached();
		await expect(
			editor.page.locator("[data-block-path='[2]'] .selection-overlay-endpoint").first()
		).toBeAttached();
	});

	test('container block does not render its own overlay when children already have overlays', async () => {
		await editor.loadContent('before\n\n> quote line 1\n> quote line 2\n\nafter\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await expect(
			editor.page.locator("[data-block-path='[1]'] > .selection-overlay-middle")
		).toHaveCount(0);
		await expect(
			editor.page.locator('[data-block-path] [data-block-path] .selection-overlay-middle').first()
		).toBeAttached();
	});
});
