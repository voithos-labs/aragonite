import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: cut', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// A cut whose selection opens at a block's first character must keep the blank line above the
	// survivor, or the reload glues it to the block above.
	test('Ctrl+X from a block start keeps the blank line above the survivor', async () => {
		await editor.loadContent('alpha\n\nbravo\n\ncharlie\n');
		await editor.dragFromTo([1], 0, [2], 4);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceEquals('alpha\n\nlie\n');

		// The failure only shows on reload: without that line the bytes reparse as one paragraph.
		await editor.loadContent(await editor.bridge.getSource());
		expect(await editor.getDomBlockCount()).toBe(2);
	});

	test('Ctrl+X then undo restores original document', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceWith((s, b) => s !== b, before);
		expect(await editor.bridge.getSource()).not.toBe(before);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
