import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('selection — keyboard: happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown at block end extends into next block', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		const sel = await editor.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('Shift+ArrowUp at block start extends into previous block', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockStart(1);
		await editor.pressKey('Shift+ArrowUp');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
	});

	test('Ctrl+Shift+End extends selection to document end', async () => {
		await editor.loadContent('start\n\nmid\n\nend\n');
		await editor.focusBlockStart(0);
		await editor.pressKey('Control+Shift+End');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		const sel = await editor.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([2]);
	});

	test('Ctrl+Shift+Home extends selection to document start', async () => {
		await editor.loadContent('start\n\nmid\n\nend\n');
		await editor.focusBlockEnd(2);
		await editor.pressKey('Control+Shift+Home');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
	});

	test('double Ctrl+A: first selects block, second selects document', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.focusBlockStart(1);
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		expect(await editor.isCrossBlockActive()).toBe(false);
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		expect(await editor.isCrossBlockActive()).toBe(true);
		const sel = await editor.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([2]);
	});
});

test.describe('selection — keyboard: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown at last block stays inactive', async () => {
		await editor.loadContent('only block\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(false);
	});

	test('Shift+ArrowUp at first block stays inactive', async () => {
		await editor.loadContent('only block\n');
		await editor.focusBlockStart(0);
		await editor.pressKey('Shift+ArrowUp');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(false);
	});

	test('Ctrl+A counter resets on non-Ctrl+A keystroke', async () => {
		await editor.loadContent('one\n\ntwo\n');
		await editor.focusBlockStart(0);
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('ArrowRight');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(false);
	});
});

test.describe('selection — keyboard: collapse', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowLeft collapses to range start', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		const before = await editor.getSelectionPaths();
		await editor.pressKey('ArrowLeft');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(false);
		const focused = await editor.page.evaluate(() => {
			const el = document.activeElement?.closest('[data-block-path]');
			return el ? JSON.parse(el.getAttribute('data-block-path')!) : null;
		});
		expect(focused).toEqual(before!.anchor.path);
	});

	test('ArrowRight collapses to range end', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		const before = await editor.getSelectionPaths();
		await editor.pressKey('ArrowRight');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(false);
		const focused = await editor.page.evaluate(() => {
			const el = document.activeElement?.closest('[data-block-path]');
			return el ? JSON.parse(el.getAttribute('data-block-path')!) : null;
		});
		expect(focused).toEqual(before!.focus.path);
	});

	test('click collapses cross-block selection', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		await editor.clickBlock(0);
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(false);
	});
});
