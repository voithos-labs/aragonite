import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: copy', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+C with cross-block selection does not mutate the document', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.getSource();
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		expect(await editor.getSource()).toBe(before);
		expect(await editor.isCrossBlockActive()).toBe(true);
	});

	test('Ctrl+C copies correct text: paste elsewhere reproduces it', async () => {
		await editor.loadContent('first\n\nsecond\n\nthird\n');
		await editor.focusBlock(0, 3);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('ArrowRight');
		await editor.page.waitForTimeout(100);
		await editor.focusBlockEnd(2);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
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
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(150);

		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await editor.pressKey('End');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toMatch(/one\n\s*\n\s*two/);
	});

	test('cross-block copy then paste into another block', async () => {
		await editor.loadContent('first block\n\nsecond block\n\nthird block\n');
		const beforeSource = await editor.getSource();

		await editor.focusBlock(0, 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await editor.pressKey('End');

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const afterSource = await editor.getSource();

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
