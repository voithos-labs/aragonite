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
		// Select from end of first through start of second
		await editor.focusBlock(0, 3); // "fir|st"
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		// Collapse to end of third and paste
		await editor.pressKey('ArrowRight');
		await editor.page.waitForTimeout(100);
		await editor.focusBlockEnd(2);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// The copied text should contain the tail of "first" + leading trivia + head of "second"
		expect(source).toContain('third');
	});

	test('cross-block copy then paste into another block', async () => {
		await editor.loadContent('first block\n\nsecond block\n\nthird block\n');
		const beforeSource = await editor.getSource();

		// Select from middle of block 0 through to block 1 via
		// Ctrl+Shift+End (enters cross-block, extends to doc end).
		await editor.focusBlock(0, 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		// Copy
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		// Collapse selection and move to end of block 2
		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await editor.pressKey('End');

		// Paste
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const afterSource = await editor.getSource();

		// The original three blocks must survive unchanged
		expect(afterSource).toContain('first block');
		expect(afterSource).toContain('second block');
		expect(afterSource).toContain('third block');

		// The pasted content must make the source strictly longer
		expect(afterSource.length).toBeGreaterThan(beforeSource.length);

		// "first block" or "second block" should appear more than once,
		// proving the cross-block copied text was pasted.
		const firstCount = afterSource.split('first block').length - 1;
		const secondCount = afterSource.split('second block').length - 1;
		expect(firstCount + secondCount).toBeGreaterThanOrEqual(3);
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
		// Select from end of block 0 through all of block 1
		await editor.pressKey('Shift+ArrowDown');
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+x');
		await editor.waitForCrossBlock(false);
		const source = await editor.getSource();
		// "bbb" was fully selected and should be gone
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
		// Enter cross-block mode
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.waitForCrossBlock(false);
		const source = await editor.getSource();
		expect(source).toContain('hello');
		expect(await editor.getBlockCount()).toBe(1);
	});

	test('Delete key deletes cross-block range', async () => {
		await editor.loadContent('abc\n\ndef\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Delete');
		await editor.waitForCrossBlock(false);
		expect(await editor.getBlockCount()).toBe(1);
	});

	test('cross-block delete spanning three blocks leaves merged result', async () => {
		await editor.loadContent('AAA\n\nBBB\n\nCCC\n');
		await editor.focusBlock(0, 1); // "A|AA"
		// Select through to offset 1 in block 2
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).not.toContain('BBB');
		// Block 0 start ("A") should survive
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
		// "start" tail was selected, so the merged result is "startX" + rest of "end"
		expect(source).toContain('X');
		expect(await editor.isCrossBlockActive()).toBe(false);
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
		// Write to clipboard and paste via real shortcut
		await editor.page.evaluate(() => navigator.clipboard.writeText('PASTED'));
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('PASTED');
		expect(source).toContain('aaa');
		expect(await editor.isCrossBlockActive()).toBe(false);
	});

	test('paste into cross-block selection covering entire list replaces it', async () => {
		await editor.loadContent('Before list\n\n- Item one\n- Item two\n- Item three\n\nAfter list\n');

		// Put "REPLACEMENT" on clipboard
		await editor.page.evaluate(() => navigator.clipboard.writeText('REPLACEMENT'));
		await editor.page.waitForTimeout(100);

		// Select the entire list via shift-click from the start of the first
		// item to the end of the last item. CST: [0] "Before list",
		// [1] list, [1,0,0] "Item one", [1,1,0] "Item two",
		// [1,2,0] "Item three", [2] "After list".
		await editor.focusBlockAtPath([1, 0, 0], 0);
		await editor.shiftClickBlock([1, 2, 0], 'Item three'.length);
		await editor.waitForCrossBlock(true);

		// Paste
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();

		// All three original items must be gone and REPLACEMENT present.
		// Before the fix, handlePaste routed via blockEdit.updateBlockContent
		// with caret.path[caret.path.length - 1] — for caret [1,0,0] that's
		// the index 0 in the listItem's children, an accidental match that
		// masked the underlying bug. The new direct-mutation path resolves
		// the target via nodeAt(doc, caret.path) regardless of depth and
		// rebuilds the container ancestry.
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
		expect(await editor.getBlockCount()).toBeGreaterThan(1);
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

		// CST: list [0] → listItem [0,0] → paragraph [0,0,0]
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		const clipText = await editor.page.evaluate(() => navigator.clipboard.readText());

		// All three markers must be present
		expect(clipText).toContain('1.');
		expect(clipText).toContain('2.');
		expect(clipText).toContain('3.');

		// No duplication — "hey" appears exactly 3 times
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
		await editor.loadContent('before\n\n- Item one\n- Item two\n  - Nested item\n- Item three\n\nafter\n');

		// path [0]="before", [1]=list, [2]="after"
		// Focus the start of "before" paragraph via its CST path
		await editor.focusBlockAtPath([0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		// Copy
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		// Collapse and focus end of "after" paragraph via CST path [2]
		await editor.pressKey('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockAtPath([2], 5); // "after" has 5 chars

		// Paste
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();

		// "Item two" should appear exactly twice (original + paste).
		// The bug produced 3+ copies due to container + leaf duplication.
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

		// Anchor at start of "first" (path [0,0,0]); focus at offset 3 in
		// "third" (path [0,2,0]) — "thi" of "third".
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 3);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());

		// All three markers must be present — the third item is partially
		// selected but its "3. " marker should still lead the partial text.
		expect(clip).toContain('1. first');
		expect(clip).toContain('2. second');
		expect(clip).toContain('3. thi');
	});
});

test.describe('cross-block clipboard: partial list promotion regression', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('selecting last list item + content below copies only that item, not entire list', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n\n```\ncode\n```\n\nFinal paragraph\n');

		// CST: list [0] → items [0,0]..[0,2] → paragraph leaves;
		//       code block [1]; paragraph [2]
		// Select from start of "Third" (path [0,2,0]) to end of document
		await editor.focusBlockAtPath([0, 2, 0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		const clipText = await editor.page.evaluate(() => navigator.clipboard.readText());

		// Only the third item should be included — not the first two
		expect(clipText).toContain('Third');
		expect(clipText).not.toContain('First');
		expect(clipText).not.toContain('Second');

		// The code block and final paragraph should also be copied
		expect(clipText).toContain('code');
		expect(clipText).toContain('Final paragraph');
	});
});
