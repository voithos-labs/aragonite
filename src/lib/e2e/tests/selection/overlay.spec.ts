import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('selection — overlay: happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('middle block overlay renders for strictly-between blocks', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		// Use Ctrl+Shift+End from block start to select all three blocks,
		// ensuring block [1] is strictly between start [0] and end [2].
		await editor.focusBlockStart(0);
		await editor.pressKey('Control+Shift+End');
		await editor.page.waitForTimeout(100);
		const middle = await editor.page.$(
			"[data-block-path='[1]'] .selection-overlay-middle"
		);
		expect(middle).not.toBeNull();
	});

	test('single-block selection has no custom overlay divs', async () => {
		await editor.loadContent('one block here\n');
		await editor.focusBlockStart(0);
		await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Shift+ArrowRight');
		await editor.page.waitForTimeout(100);
		const overlays = await editor.page.$$('.selection-overlay');
		expect(overlays.length).toBe(0);
	});

	test('overlay disappears when selection collapses', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		const before = await editor.page.$$('.selection-overlay');
		expect(before.length).toBeGreaterThan(0);
		await editor.pressKey('ArrowLeft');
		await editor.page.waitForTimeout(100);
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
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
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
		const endOverlays = await editor.page.$$(
			"[data-block-path='[2]'] .selection-overlay-endpoint"
		);
		expect(startOverlays.length).toBeGreaterThan(0);
		expect(endOverlays.length).toBeGreaterThan(0);
	});
});
