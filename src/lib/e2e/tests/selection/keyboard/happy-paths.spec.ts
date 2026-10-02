import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('selection: keyboard: happy paths', () => {
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
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([2]);
	});

	test('Ctrl+Shift+Home extends selection to document start', async () => {
		await editor.loadContent('start\n\nmid\n\nend\n');
		await editor.focusBlockEnd(2);
		await editor.page.keyboard.press('ControlOrMeta+Shift+Home');
		await editor.waitForCrossBlock(true);
	});

	test('double Ctrl+A: first selects block, second selects document', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('ControlOrMeta+a');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([2]);
	});

	// A dragged range never counted a first Ctrl+A, so one press has to take the whole document.
	test('Ctrl+A over a dragged range selects the whole document', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.dragFromTo([0], 1, [1], 2);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('ControlOrMeta+a');
		await expect
			.poll(() => editor.bridge.getSelection())
			.toEqual({ anchor: { path: [0], offset: 0 }, focus: { path: [2], offset: 5 } });
	});
});
