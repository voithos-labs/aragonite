import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection — keyboard: collapse', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowLeft collapses to range start', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const before = await editor.bridge.getSelectionPaths();
		await editor.page.keyboard.press('ArrowLeft');
		await editor.waitForCrossBlock(false);
		const focused = await editor.page.evaluate(() => {
			const el = document.activeElement?.closest('[data-block-path]');
			return el ? JSON.parse(el.getAttribute('data-block-path')!) : null;
		});
		expect(focused).toEqual(before!.anchor.path);
	});

	test('ArrowRight collapses to range end', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const before = await editor.bridge.getSelectionPaths();
		await editor.page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		const focused = await editor.page.evaluate(() => {
			const el = document.activeElement?.closest('[data-block-path]');
			return el ? JSON.parse(el.getAttribute('data-block-path')!) : null;
		});
		expect(focused).toEqual(before!.focus.path);
	});

	test('click collapses cross-block selection', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.clickBlock(0);
		await editor.waitForCrossBlock(false);
	});
});
