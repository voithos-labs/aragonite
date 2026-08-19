import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('selection — pointer: happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('drag from block 0 into block 1 enters cross-block mode', async () => {
		await editor.loadContent('first paragraph\n\nsecond paragraph\n');
		await editor.dragFromTo([0], 2, [1], 5);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel?.anchor.path).toEqual([0]);
		expect(sel?.focus.path).toEqual([1]);
	});

	test('drag across three paragraphs renders middle overlay', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		await editor.dragFromTo([0], 0, [2], 3);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		await expect(
			editor.page.locator("[data-block-path='[1]'] .selection-overlay-middle").first()
		).toBeAttached();
	});

	test('shift+click in a different block enters cross-block mode', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockEnd(0);
		await editor.shiftClickBlock([1], 3);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});
});

test.describe('selection — pointer: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('drag inside one block does not enter cross-block mode', async () => {
		await editor.loadContent('single block of text here\n');
		await editor.dragFromTo([0], 0, [0], 10);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('click collapses active cross-block selection', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.clickBlock(0);
		await editor.waitForCrossBlock(false);
	});

	test('click collapse restores native caret in the clicked block', async () => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.clickBlock(1);
		await editor.waitForCrossBlock(false);

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');
		const source = await editor.bridge.getSource();
		const betaBlock = source.split('\n\n').find((s) => s.includes('beta'));
		expect(betaBlock).toContain('X');
	});

	test('drag out to remote block then back to anchor collapses cross-block', async () => {
		await editor.loadContent('alpha line\n\nbeta line\n\ngamma line\n');
		await editor.dragFromToThenTo([0], 2, [2], 5, [0], 6);
		await editor.waitForCrossBlock(false);

		await expect(
			editor.page.locator("[data-block-path='[1]'] .selection-overlay-middle")
		).toHaveCount(0);

		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).not.toContain('beta');
		expect(selectedText).not.toContain('gamma');
	});
});

test.describe('selection — pointer: cross-container', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('drag across a blockquote boundary selects cross-container', async () => {
		await editor.loadContent('before\n\n> quote line\n\nafter\n');
		await editor.dragFromTo([0], 0, [2], 3);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});
});
