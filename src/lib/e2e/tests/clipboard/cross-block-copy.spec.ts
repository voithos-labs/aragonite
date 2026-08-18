import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: copy', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+C with cross-block selection does not mutate the document', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('Ctrl+C copies correct text: paste elsewhere reproduces it', async () => {
		await editor.loadContent('first\n\nsecond\n\nthird\n');
		await editor.focusBlock(0, 3);
		await editor.page.keyboard.press('Shift+ArrowDown');
		// Shift+ArrowDown mid-block stays native (no cross-block bridge state);
		// poll DOM selection until extension lands.
		await editor.page.waitForFunction(
			() => (window.getSelection()?.toString().length ?? 0) > 0,
			null,
			{ timeout: 2000, polling: 16 }
		);
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.page.keyboard.press('ArrowRight');
		await editor.focusBlockEnd(2);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/third\s*st/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/third\s*st/);
		expect(source).toContain('sec');
		expect(source).toContain('first');
		expect(source).toContain('second');
	});

	test('copy two blank-separated paragraphs, paste elsewhere preserves the blank line', async () => {
		await editor.loadContent('one\n\ntwo\n\ntarget\n');

		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([1], 3);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await editor.page.keyboard.press('End');
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/target[\s\S]*\n\s*\n\s*two/);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/target[\s\S]*\n\s*\n\s*two/);
	});

	test('cross-block copy then paste into another block', async () => {
		await editor.loadContent('first block\n\nsecond block\n\nthird block\n');
		const beforeSource = await editor.bridge.getSource();

		await editor.focusBlock(0, 0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await editor.page.keyboard.press('End');

		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/first block[\s\S]*first block/);

		const afterSource = await editor.bridge.getSource();

		expect(afterSource).toContain('first block');
		expect(afterSource).toContain('second block');
		expect(afterSource).toContain('third block');

		expect(afterSource.length).toBeGreaterThan(beforeSource.length);

		const firstCount = afterSource.split('first block').length - 1;
		const secondCount = afterSource.split('second block').length - 1;
		expect(firstCount).toBe(2);
		expect(secondCount).toBe(2);
	});
});
