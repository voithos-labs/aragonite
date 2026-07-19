import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('paste materializes blank lines as empty-paragraph blocks', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typed: produces 3 blocks', async () => {
		await editor.loadContent('');
		await editor.focusBlockAtPath([0], 0);
		await editor.typeText('one');
		await editor.page.keyboard.press('Enter');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('two');
		await editor.bridge.waitForSourceEquals('one\n\ntwo\n');

		expect(await editor.bridge.getSource()).toBe('one\n\ntwo\n');
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('pasted via clipboard: same source, should produce 3 blocks (matches typed)', async () => {
		await editor.loadContent('');
		await editor.page.evaluate(() => navigator.clipboard.writeText('one\n\ntwo'));
		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('two');

		const src = await editor.bridge.getSource();
		const domCount = await editor.getDomBlockCount();

		// Windows clipboard writes CRLF.
		expect(src.replace(/\r\n/g, '\n').replace(/\s+$/, '')).toBe('one\n\ntwo');
		expect(domCount).toBe(3);
	});

	// Finding 7.6: a mid-paragraph structural paste lands the caret at the end of
	// the pasted content, not the trailing residue. Typing appends to the paste.
	test('mid-paragraph multi-block paste lands the caret at the end of the pasted content', async () => {
		await editor.loadContent('helloworld\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('one\n\ntwo'));
		await editor.focusBlockAtPath([0], 5); // between "hello" and "world"
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('two');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('twoZ');

		const src = await editor.bridge.getSource();
		expect(src).toContain('twoZ');
		expect(src).not.toContain('worldZ');
	});
});
