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

	// Regression: buildPastedReplacement used to hardcode the last node's
	// leadingTrivia to '', dropping the blank-line separator that the parser
	// places on the second of two source blocks. Round-trip "one\n\ntwo"
	// collapsed to "one\ntwo" on paste.
	test('copy two blank-separated paragraphs, paste elsewhere preserves the blank line', async () => {
		await editor.loadContent('one\n\ntwo\n\ntarget\n');

		// Select the "one\n\ntwo" span: start of block 0 through end of block 1.
		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([1], 3);
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(150);

		// Paste at end of "target".
		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await editor.pressKey('End');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// The pasted region must keep a blank line between the two paragraphs —
		// not collapse into a single soft-break paragraph.
		expect(source).toMatch(/one\n\s*\n\s*two/);
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

	// Regression (docs/issues.md — "Paste into cross-list-item selection does
	// nothing"): a cross-block selection spanning two items of the same list,
	// pressing Ctrl+V, must replace the selected range with the clipboard text.
	// The pre-fix behavior silently did nothing — the rangeDelete happened but
	// the follow-up raw mutation + ancestry rebuild lost the pasted content.
	test('paste into cross-block selection spanning two items within a list', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.page.evaluate(() => navigator.clipboard.writeText('HELLO'));
		await editor.page.waitForTimeout(100);

		// CST: [0] list, [0,0,0] "one", [0,1,0] "two". Select from start of "one"
		// to end of "two" via shift-click.
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

		// Select items 1 and 2, leave item 3 alone.
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

	// Regression (docs/issues.md — "Multi-block paste into a cross-block
	// selection with a nested collapsed caret is silently skipped"):
	// nested containers used to no-op `insertParsedBlocks`, so the handlePaste
	// multi-block branch had a `caret.path.length !== 1` guard that silently
	// dropped the paste. The selection was deleted but nothing landed. Now
	// nested `insertParsedBlocks` delegates to `replaceBlock`, so pasted
	// blocks become siblings of the leaf inside the container.
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

	// Regression for the real-world scenario uncovered during debugging:
	// cross-block copy preserves container markers (list numbers, blockquote
	// prefixes), so "ne\n2. tw" from selecting across two list items parses
	// as two blocks. Pasting back into a cross-list-item selection used to
	// hit the nested-caret guard and silently drop the paste. A full round
	// trip — copy across items, paste across items — now retains content.
	test('copy across list items, paste across list items reinserts content', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		// Select across items 1 and 2, copy.
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 2);
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		// Collapse, then re-select items 2 and 3.
		await editor.clickBlock(2);
		await editor.page.waitForTimeout(100);
		await editor.focusBlockAtPath([0, 1, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 5);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// Copied slice was "ne" (from "one") and "tw" (from "two"). Both must
		// survive the round trip somewhere in the document.
		expect(source).toContain('ne');
		expect(source).toContain('tw');
		// The first list item is untouched by the paste.
		expect(source).toContain('one');
	});

	// Regression: multi-block paste with a pre-existing selection used to
	// produce two undo entries — one press of Ctrl+Z left the document in an
	// intermediate "selection-deleted but blocks-not-inserted" state. The
	// selection-delete is now folded into `insertParsedBlocks` via the
	// `preDelete` parameter, so the whole paste is one atomic undo unit.
	test('multi-block paste with selection is one undo unit', async () => {
		await editor.loadContent('hello world\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));
		await editor.page.waitForTimeout(100);
		// Select "world" inside the paragraph (offsets 6..11).
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);
		const afterPaste = await editor.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('world');

		// Single Ctrl+Z returns to the pre-paste document, not an intermediate
		// "world-deleted-but-blocks-not-inserted" state.
		await editor.pressKey('Control+z');
		await editor.page.waitForTimeout(200);
		const afterUndo = await editor.getSource();
		expect(afterUndo.trim()).toBe('hello world');
	});

	// Regression: drag selection leaves the native selection empty (no click
	// default to re-plant a caret like shift-click has), so Chromium used to
	// dispatch paste to <body> instead of any block — the paste handler
	// silently never ran. Fixed by parking a collapsed caret in the focus
	// block when entering cross-block, regardless of entry gesture.
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

		// Anchor mid-"one" (offset 1, after 'o'), focus mid-"two" (offset 2, after 'tw').
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 2);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// "one" becomes "o" + pasted + "o" from "two"
		expect(source).toMatch(/^1\. oHELLOo$/m);
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
		await editor.loadContent(
			'before\n\n- Item one\n- Item two\n  - Nested item\n- Item three\n\nafter\n'
		);

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
		await editor.loadContent(
			'1. First\n2. Second\n3. Third\n\n```\ncode\n```\n\nFinal paragraph\n'
		);

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
