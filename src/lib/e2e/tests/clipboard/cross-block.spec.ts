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

test.describe('cross-block clipboard: cut', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+X deletes the cross-block range', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+x');
		await editor.waitForCrossBlock(false);
		const source = await editor.getSource();
		expect(source).not.toContain('bbb');
		expect(source).toContain('aaa');
	});

	test('Ctrl+X then undo restores original document', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.getSource();
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).not.toBe(before);
		await editor.undo();
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).toBe(before);
	});
});

test.describe('cross-block clipboard: delete/backspace', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace deletes cross-block range and merges endpoints', async () => {
		await editor.loadContent('hello\n\nworld\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.waitForCrossBlock(false);
		const source = await editor.getSource();
		expect(source).toContain('hello');
		expect(await editor.getDomBlockCount()).toBe(1);
	});

	test('Delete key deletes cross-block range', async () => {
		await editor.loadContent('abc\n\ndef\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Delete');
		await editor.waitForCrossBlock(false);
		expect(await editor.getDomBlockCount()).toBe(1);
	});

	test('cross-block delete spanning three blocks leaves merged result', async () => {
		await editor.loadContent('AAA\n\nBBB\n\nCCC\n');
		await editor.focusBlock(0, 1);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).not.toContain('BBB');
		expect(source).toContain('A');
	});
});

test.describe('cross-block clipboard: type-replace', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing over cross-block selection replaces it', async () => {
		await editor.loadContent('start\n\nend\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('X');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('X');
		expect(await editor.isCrossBlockActive()).toBe(false);
	});

	// A2/A3: cross-block typed character + range delete is a single undo unit.
	test('typing over cross-block selection then undo restores original document', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.getSource();

		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Z');
		await editor.page.waitForTimeout(300);

		const afterType = await editor.getSource();
		expect(afterType).not.toBe(before);
		expect(afterType).toContain('Z');

		await editor.pressKey('Control+z');
		await editor.page.waitForTimeout(300);
		const afterUndo = await editor.getSource();
		expect(afterUndo.trim()).toBe(before.trim());
	});
});

test.describe('cross-block clipboard: paste', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+V with cross-block selection deletes range and pastes', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.evaluate(() => navigator.clipboard.writeText('PASTED'));
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('PASTED');
		expect(source).toContain('aaa');
		expect(await editor.isCrossBlockActive()).toBe(false);
	});

	test('paste into cross-block selection spanning two items within a list', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('HELLO'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('HELLO');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
	});

	test('paste into cross-block selection covering two of three list items', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('HELLO'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('HELLO');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
		expect(source).toContain('three');
	});

	test('paste into cross-block selection covering items 2 and 3 of a 3-item list', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('HELLO'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 1, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 'three'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('one');
		expect(source).toContain('HELLO');
		expect(source).not.toContain('two');
		expect(source).not.toContain('three');
	});

	test('paste MULTI-BLOCK content into cross-block selection spanning two list items', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('alpha');
		expect(source).toContain('beta');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
	});

	test('copy across list items, paste across list items reinserts content', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 2);
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		await editor.clickBlock(2);
		await editor.page.waitForTimeout(100);
		await editor.focusBlockAtPath([0, 1, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 5);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('ne');
		expect(source).toContain('tw');
		expect(source).toMatch(/\bone\b/);
	});

	test('multi-block paste with selection is one undo unit', async () => {
		await editor.loadContent('hello world\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));
		await editor.page.waitForTimeout(100);
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const afterPaste = await editor.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('world');

		await editor.pressKey('Control+z');
		await editor.page.waitForTimeout(200);
		const afterUndo = await editor.getSource();
		expect(afterUndo.trim()).toBe('hello world');
	});

	// Regression: drag selection leaves the native selection empty, so Chromium
	// dispatched paste to <body> instead of any block. Fixed by parking a
	// collapsed caret in the focus block when entering cross-block.
	test('drag selection across list items: paste single-block text lands', async () => {
		await editor.loadContent('1. one\n2. two\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('text'));
		await editor.page.waitForTimeout(100);

		await editor.dragFromTo([0, 0, 0], 0, [0, 1, 0], 3);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('text');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
	});

	test('paste into cross-block selection with mid-paragraph offsets in two list items', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('HELLO'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 2);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toMatch(/^1\. oHELLOo$/m);
	});

	test('paste into cross-block selection covering entire list replaces it', async () => {
		await editor.loadContent('Before list\n\n- Item one\n- Item two\n- Item three\n\nAfter list\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('REPLACEMENT'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([1, 0, 0], 0);
		await editor.shiftClickBlock([1, 2, 0], 'Item three'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();

		expect(source).toContain('Before list');
		expect(source).toContain('REPLACEMENT');
		expect(source).toContain('After list');
		expect(source).not.toContain('Item one');
		expect(source).not.toContain('Item two');
		expect(source).not.toContain('Item three');
	});
});

test.describe('cross-block clipboard: multi-block paste at single caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pasting two paragraphs creates multiple blocks', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => navigator.clipboard.writeText('# Heading\n\nNew paragraph\n'));
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('# Heading');
		expect(source).toContain('New paragraph');
		expect(await editor.getBlockCount()).toBe(3);
	});

	test('multi-block paste replaces selected text', async () => {
		await editor.loadContent('Hello World\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.evaluate(() => navigator.clipboard.writeText('First\n\nSecond'));
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).not.toContain('World');
		expect(source).toContain('Hello ');
		expect(source).toContain('First');
		expect(source).toContain('Second');
	});
});

test.describe('cross-block clipboard: list marker preservation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered list copy preserves all item markers', async () => {
		await editor.loadContent('1. hey\n2. hey\n3. hey\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		const clipText = await editor.page.evaluate(() => navigator.clipboard.readText());

		expect(clipText).toContain('1.');
		expect(clipText).toContain('2.');
		expect(clipText).toContain('3.');

		const heyCount = clipText.split('hey').length - 1;
		expect(heyCount).toBe(3);
	});
});

test.describe('cross-block clipboard: list duplication regression', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cross-block copy of a list does not duplicate nested content', async () => {
		await editor.loadContent(
			'before\n\n- Item one\n- Item two\n  - Nested item\n- Item three\n\nafter\n'
		);

		await editor.focusBlockAtPath([0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		await editor.pressKey('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockAtPath([2], 5);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();

		const itemTwoCount = source.split('Item two').length - 1;
		expect(itemTwoCount).toBe(2);

		const nestedCount = source.split('Nested item').length - 1;
		expect(nestedCount).toBe(2);
	});
});

test.describe('cross-block clipboard: partial end list marker', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('partial last-item selection preserves list marker in clipboard', async () => {
		await editor.loadContent('1. first\n2. second\n3. third\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 3);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());

		expect(clip).toContain('1. first');
		expect(clip).toContain('2. second');
		expect(clip).toContain('3. thi');
	});
});

test.describe('cross-block clipboard: structural paste discriminator', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pasting a list at end of paragraph creates list block, no content dropped', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => navigator.clipboard.writeText('- foo\n- bar\n'));
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('foo');
		expect(source).toContain('bar');
		expect(await editor.getBlockCount()).toBe(2);
	});

	test('pasting a list inside a list item preserves all pasted items', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		await editor.focusBlockAtPath([0, 0, 0], 'one'.length);
		await editor.page.evaluate(() => navigator.clipboard.writeText('- foo\n- bar\n'));
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('foo');
		expect(source).toContain('bar');
		expect(source).toContain('two');
		expect(source).toContain('three');
	});

	test('pasting a heading at end of paragraph creates a heading block', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => navigator.clipboard.writeText('## A heading\n'));
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('## A heading');
		expect(await editor.getBlockCount()).toBe(2);
	});

	test('cross-block paste of multi-block content into list items lands content', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n\ngamma\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('alpha');
		expect(source).toContain('beta');
		expect(source).toContain('gamma');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
		expect(source).toContain('three');
	});
});

test.describe('cross-block clipboard: single-undo paste guarantees', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cross-block top-level paste of multi-block content is one undo unit', async () => {
		await editor.loadContent('hello\n\nworld\n');
		const before = await editor.getSource();

		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([1], 'world'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const afterPaste = await editor.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('hello');
		expect(afterPaste).not.toContain('world');

		await editor.pressKey('Control+z');
		await editor.page.waitForTimeout(300);
		const afterUndo = await editor.getSource();
		expect(afterUndo.trim()).toBe(before.trim());
	});

	test('cross-block paste across list items is one undo unit', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		const before = await editor.getSource();

		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const afterPaste = await editor.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');

		await editor.pressKey('Control+z');
		await editor.page.waitForTimeout(300);
		const afterUndo = await editor.getSource();
		expect(afterUndo.trim()).toBe(before.trim());
	});
});

test.describe('cross-block clipboard: partial list promotion regression', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('selecting last list item + content below copies only that item, not entire list', async () => {
		await editor.loadContent(
			'1. First\n2. Second\n3. Third\n\n```\ncode\n```\n\nFinal paragraph\n'
		);

		await editor.focusBlockAtPath([0, 2, 0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		const clipText = await editor.page.evaluate(() => navigator.clipboard.readText());

		expect(clipText).toContain('Third');
		expect(clipText).not.toContain('First');
		expect(clipText).not.toContain('Second');

		expect(clipText).toContain('code');
		expect(clipText).toContain('Final paragraph');
	});
});
