import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection — keyboard: happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown at block end extends into next block', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('Shift+ArrowUp at block start extends into previous block', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);
	});

	test('Shift+ArrowDown from mid-block anchor with focus at end extends cross-block', async () => {
		await editor.loadContent('first paragraph\n\nsecond\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('Ctrl+Shift+End extends selection to document end', async () => {
		await editor.loadContent('start\n\nmid\n\nend\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([2]);
	});

	test('Ctrl+Shift+Home extends selection to document start', async () => {
		await editor.loadContent('start\n\nmid\n\nend\n');
		await editor.focusBlockEnd(2);
		await editor.page.keyboard.press('Control+Shift+Home');
		await editor.waitForCrossBlock(true);
	});

	test('double Ctrl+A: first selects block, second selects document', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Control+a');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([2]);
	});
});
