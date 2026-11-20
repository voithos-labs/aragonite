import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A list pasted over a range from an item's end into the paragraph below: the removal joins the
// paragraph's tail to the item, the first pasted item joins it at the caret, and the clipboard's
// last line ending opens the next item with that tail in it, as Enter does there.
test.describe('cross-block list paste: the items land at the caret the removal left', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const source = async () => (await editor.bridge.getSource()).replace(/\r\n/g, '\n');

	const pasteOverRange = async (clip: string) => {
		await editor.loadContent('- alpha\n\nbeta gamma\n');
		await editor.seedClipboard(clip);
		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.shiftClickBlock([1], 'beta '.length);
		await editor.waitForCrossBlock(true);
		await editor.paste();
	};

	test('two items: the first joins the item, the ending opens the next with the tail', async () => {
		await pasteOverRange('- x\n- y\n');
		await editor.bridge.waitForSourceMatches(/^- gamma$/m);
		expect(await source()).toBe('- alphax\n- y\n- gamma\n');

		await editor.page.keyboard.type('Z');
		await editor.bridge.waitForSourceMatches(/^- Zgamma$/m);
		expect(await source()).toBe('- alphax\n- y\n- Zgamma\n');
	});

	test('one item: it joins the item, the ending opens the next with the tail', async () => {
		await pasteOverRange('- x\n');
		await editor.bridge.waitForSourceMatches(/^- gamma$/m);
		expect(await source()).toBe('- alphax\n- gamma\n');

		await editor.page.keyboard.type('Z');
		await editor.bridge.waitForSourceMatches(/^- Zgamma$/m);
		expect(await source()).toBe('- alphax\n- Zgamma\n');
	});
});
