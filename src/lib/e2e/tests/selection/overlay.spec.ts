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
		const middle = await editor.page.$("[data-block-path='[1]'] .selection-overlay-middle");
		expect(middle).not.toBeNull();
	});

	test('single-block selection has no custom overlay divs', async () => {
		await editor.loadContent('one block here\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.waitForCrossBlock(false);
		const overlays = await editor.page.$$('.selection-overlay');
		expect(overlays.length).toBe(0);
	});

	test('overlay disappears when selection collapses', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const before = await editor.page.$$('.selection-overlay');
		expect(before.length).toBeGreaterThan(0);
		await editor.page.keyboard.press('ArrowLeft');
		await editor.waitForCrossBlock(false);
		const after = await editor.page.$$('.selection-overlay');
		expect(after.length).toBe(0);
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
		const startOverlays = await editor.page.$$(
			"[data-block-path='[0]'] .selection-overlay-endpoint"
		);
		const endOverlays = await editor.page.$$("[data-block-path='[2]'] .selection-overlay-endpoint");
		expect(startOverlays.length).toBeGreaterThan(0);
		expect(endOverlays.length).toBeGreaterThan(0);
	});

	test('container block does not render its own overlay when children already have overlays', async () => {
		await editor.loadContent('before\n\n> quote line 1\n> quote line 2\n\nafter\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		const containerOverlay = await editor.page.$(
			"[data-block-path='[1]'] > .selection-overlay-middle"
		);
		expect(containerOverlay).toBeNull();

		const innerOverlays = await editor.page.$$(
			'[data-block-path] [data-block-path] .selection-overlay-middle'
		);
		expect(innerOverlays.length).toBeGreaterThan(0);
	});

	test('start endpoint block renders partial overlay rects', async () => {
		await editor.loadContent('first block text\n\nsecond block text\n');
		await editor.dragFromTo([0], 6, [1], 6);

		const startOverlays = await editor.page.$$(
			"[data-block-path='[0]'] .selection-overlay-endpoint"
		);
		expect(startOverlays.length).toBeGreaterThan(0);

		const endOverlays = await editor.page.$$("[data-block-path='[1]'] .selection-overlay-endpoint");
		expect(endOverlays.length).toBeGreaterThan(0);
	});
});
