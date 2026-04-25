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
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('Shift+ArrowUp at block start extends into previous block', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.bridge.waitForCrossBlock(true);
	});

	test('Shift+ArrowDown from mid-block anchor with focus at end extends cross-block', async () => {
		await editor.loadContent('first paragraph\n\nsecond\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1]);
	});

	test('Ctrl+Shift+End extends selection to document end', async () => {
		await editor.loadContent('start\n\nmid\n\nend\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.bridge.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([2]);
	});

	test('Ctrl+Shift+Home extends selection to document start', async () => {
		await editor.loadContent('start\n\nmid\n\nend\n');
		await editor.focusBlockEnd(2);
		await editor.page.keyboard.press('Control+Shift+Home');
		await editor.bridge.waitForCrossBlock(true);
	});

	test('double Ctrl+A: first selects block, second selects document', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		await editor.page.keyboard.press('Control+a');
		await editor.bridge.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
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
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(false);
	});

	test('Shift+ArrowUp at first block stays inactive', async () => {
		await editor.loadContent('only block\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.bridge.waitForCrossBlock(false);
	});

	test('Ctrl+A counter resets on non-Ctrl+A keystroke', async () => {
		await editor.loadContent('one\n\ntwo\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(100);
		await editor.page.keyboard.press('ArrowRight');
		await editor.page.waitForTimeout(100);
		await editor.page.keyboard.press('Control+a');
		await editor.bridge.waitForCrossBlock(false);
	});

	test('Shift+ArrowDown from paragraph into blockquote activates cross-block', async () => {
		await editor.loadContent('above\n\n> inside quote\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path[0]).toBe(1);
	});

	test('empty document: double Ctrl+A then typed char replaces the empty block without crashing', async () => {
		// Empty doc = single blank paragraph. The earlier version of this test
		// only asserted `getSource() === before` after two Ctrl+A presses,
		// which was trivially true — Ctrl+A doesn't mutate source. The real
		// invariant: after the double Ctrl+A, pressing a character key should
		// replace the (empty) selected content with that character, leaving
		// exactly one block whose raw contains the typed char. Regressions in
		// the double-press escalation or the cross-block type-replace path
		// would either crash, produce extra blocks, or lose the char.
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);

		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(50);
		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(50);

		await editor.typeText('X');
		await editor.page.waitForTimeout(100);

		expect(await editor.bridge.getDomBlockCount()).toBe(1);
		// The typed char must land in the surviving block. Exact line-ending
		// shape is browser-controlled and not the regression we're guarding.
		expect(await editor.bridge.getSource()).toContain('X');
	});

	test('thematic break between endpoints gets overlay, no crash', async () => {
		await editor.loadContent('above\n\n---\n\nbelow\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.bridge.waitForCrossBlock(true);
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});
});

test.describe('selection — keyboard: shift+arrow contraction (D1)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowLeft contracts a forward single-block selection without crossing block boundary', async () => {
		// Forward selection: anchor=0, focus=5 ("Hello" highlighted left-to-right).
		// Shift+ArrowLeft should contract to anchor=0, focus=4 ("Hell"); the bug
		// fired cross-block extension instead because the legacy code read
		// getCursorOffset() (range start = 0) and treated focus as already at 0.
		await editor.loadContent('Hello world\n\nbelow\n');
		await editor.focusBlock(0, 0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.page.waitForTimeout(50);

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('Hell');
	});

	test('Shift+ArrowRight contracts a backward single-block selection without crossing block boundary', async () => {
		// Backward selection: anchor=5, focus=0 ("Hello" selected right-to-left).
		// Shift+ArrowRight should contract to anchor=5, focus=1 ("ello"); the bug
		// would extend cross-block (focus=0 is at the block start so the legacy
		// path sent us into extendFocusToPreviousBlock).
		await editor.loadContent('above\n\nHello world\n');
		await editor.focusBlock(1, 5);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowLeft');
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.waitForTimeout(50);

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('ello');
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
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(true);
		const before = await editor.bridge.getSelectionPaths();
		await editor.page.keyboard.press('ArrowLeft');
		await editor.bridge.waitForCrossBlock(false);
		const focused = await editor.page.evaluate(() => {
			const el = document.activeElement?.closest('[data-block-path]');
			return el ? JSON.parse(el.getAttribute('data-block-path')!) : null;
		});
		expect(focused).toEqual(before!.anchor.path);
	});

	test('ArrowRight collapses to range end', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(true);
		const before = await editor.bridge.getSelectionPaths();
		await editor.page.keyboard.press('ArrowRight');
		await editor.bridge.waitForCrossBlock(false);
		const focused = await editor.page.evaluate(() => {
			const el = document.activeElement?.closest('[data-block-path]');
			return el ? JSON.parse(el.getAttribute('data-block-path')!) : null;
		});
		expect(focused).toEqual(before!.focus.path);
	});

	test('click collapses cross-block selection', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(true);
		await editor.clickBlock(0);
		await editor.bridge.waitForCrossBlock(false);
	});
});
