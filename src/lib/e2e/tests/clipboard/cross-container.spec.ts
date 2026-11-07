import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { extendKey } from '../../platform-keys';

test.describe('cross-container clipboard: blockquote boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cut with anchor inside blockquote and focus outside', async () => {
		await editor.loadContent('> quoted line\n\noutside\n');
		await editor.focusBlockAtPath([0, 0], 11);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.waitForCrossBlock(false);
		const source = await editor.bridge.getSource();
		// "start wins": the blockquote context should survive.
		expect(source).toContain('>');
	});

	test('cut with anchor outside and focus inside blockquote', async () => {
		await editor.loadContent('before\n\n> quoted\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.waitForCrossBlock(false);
		const source = await editor.bridge.getSource();
		// "start wins": the paragraph context should survive.
		expect(source).toContain('before');
	});

	test('backspace across container boundary merges into start context', async () => {
		await editor.loadContent('top\n\n> inside quote\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('> inside quote');
		const source = await editor.bridge.getSource();
		expect(source).toContain('top');
		expect(source).not.toContain('> inside quote');
	});

	test('cross-container cut then undo restores structure', async () => {
		await editor.loadContent('above\n\n> blockquote text\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceWith((source, original) => source !== original, before);
		expect(await editor.bridge.getSource()).not.toBe(before);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('a copy from a paragraph into a quote writes the quote’s lines with their markers', async () => {
		await editor.loadContent('para one\n\n> quote two\n');
		await editor.clickBlockAtPath([0], 5);
		await editor.shiftClickBlock([1, 0], 5);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardContains('quote', 5000);

		expect(await editor.readClipboard()).toBe('one\n\n> quote');
		expect(await editor.bridge.ownsRange()).toBe(true);
	});

	test('a cut from a paragraph into a nested quote writes every quote level it covers', async () => {
		await editor.setPresentationMode('live');
		await editor.loadContent(
			'alpha bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you set out for Ithaka\n> > hope your road is a long one,\n'
		);
		await editor.clickBlockAtPath([0], 6);
		await editor.shiftClickBlock([1, 1, 0], 7);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.waitForClipboardContains('Ithaka', 5000);

		expect(await editor.readClipboard()).toBe(
			'bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you '
		);
	});

	test('copy from inside blockquote to paragraph then paste reproduces text', async () => {
		await editor.loadContent('> quoted text\n\noutside\n\ndestination\n');
		await editor.focusBlockAtPath([0, 0], 0);
		await editor.page.keyboard.press(extendKey('docEnd'));
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		await editor.page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockEnd(2);
		await editor.paste();
		await editor.bridge.waitForSourceMatches(/quoted text[\s\S]*quoted text/);

		const source = await editor.bridge.getSource();
		expect(source.split('quoted text').length - 1).toBeGreaterThanOrEqual(2);
		expect(source.split('outside').length - 1).toBeGreaterThanOrEqual(2);
		// The paste must land in the destination block, not the 'outside' block above it: had focus
		// drifted, block [1] would have taken the clipboard's first line.
		expect((await editor.getBlockText(1)).trim()).toBe('outside');
	});

	test('cut from paragraph across blockquote then undo restores both', async () => {
		await editor.loadContent('top paragraph\n\n> blockquote text\n\nbottom\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceWith(
			(source, original) => source.length < original.length,
			before
		);

		const afterCut = await editor.bridge.getSource();
		expect(afterCut.length).toBeLessThan(before.length);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
