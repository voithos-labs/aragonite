import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { SIMPLE_CONTENT } from '../test-content';

test.describe('keyboard navigation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// ── Happy paths ─────────────────────────────────────────────────────

	test('ArrowDown at end of block moves focus to next block', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockEnd(0);
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// ArrowDown lands cursor at START of next block
		expect(source).toContain('XSecond paragraph');
	});

	test('ArrowUp at start of block moves focus to previous block', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(1);
		await editor.pressArrowUp();
		await editor.typeText('Y');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Sticky column: ArrowUp from column 0 of block 1 preserves column 0,
		// landing cursor at START of block 0 (not at the end).
		expect(source).toContain('YFirst paragraph.');
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	test('ArrowDown at end of last block creates new paragraph', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		const countBefore = await editor.getDomBlockCount();
		const lastIndex = countBefore - 1;
		await editor.focusBlockEnd(lastIndex);
		await editor.pressArrowDown();
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);

		// A new paragraph should have been created after the last block
		const countAfter = await editor.getDomBlockCount();
		expect(countAfter).toBe(countBefore + 1);
		const source = await editor.getSource();
		expect(source).toContain('Z');
	});

	test('ArrowUp at start of first block does nothing', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(0);
		await editor.pressArrowUp();
		await editor.typeText('A');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "A" should still be in the first block
		expect(source).toMatch(/A.*First paragraph|First paragraphA/);
	});

	test('ArrowDown into container block enters first child', async () => {
		await editor.loadContent('Before\n\n> Inside quote\n');

		await editor.focusBlockEnd(0);
		await editor.pressArrowDown();
		await editor.typeText('Q');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "Q" should appear inside the blockquote, not outside
		expect(source).toMatch(/> .*Inside quoteQ|> .*QInside quote/);
	});

	test('ArrowUp out of container block exits to block before', async () => {
		await editor.loadContent('Above\n\n> Quote content\n');

		// Focus start of the blockquote's first child
		const bqEditable = editor.getBlock(1).locator('[contenteditable="true"]').first();
		await bqEditable.click();
		// Place cursor at start
		await editor.page.keyboard.press('Home');
		await editor.pressArrowUp();
		await editor.typeText('B');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Sticky column: ArrowUp carries the source X across the blockquote
		// boundary. Column 0 inside `> Quote content` renders at the blockquote
		// indent offset, so B lands inside "Above" at the offset nearest that
		// X (not at the end). Test intent is "ArrowUp exits the container" —
		// verify B is in a non-blockquote line. Exact offset depends on the
		// cross-indent pixel mapping and is covered by dedicated sticky-column
		// E2E tests (Tasks 15–17).
		expect(source).toMatch(/^[^>].*B/m);
	});

	test('ArrowDown on empty block moves to the next block', async () => {
		// Create an empty block between two paragraphs
		await editor.loadContent('Above.\n\nBelow.\n');
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);

		// Now in the empty block (index 1). Press ArrowDown.
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		// ArrowDown from an empty block (single visual line) moves to the
		// next block — geometry check triggers because the cursor is on the
		// last visual line of the empty block.
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('XBelow.');
	});

	// ── User interactions ───────────────────────────────────────────────

	test('navigate down through multiple blocks and type in final', async () => {
		await editor.loadContent('Block one.\n\nBlock two.\n\nBlock three.\n');

		await editor.focusBlockEnd(0);
		await editor.pressArrowDown();
		await editor.pressArrowDown();

		// After two ArrowDowns from first block we should be past second block.
		// The cursor may land at start of third or end of second depending on
		// the exact offset — type and verify it lands in a later block.
		await editor.page.keyboard.press('End');
		await editor.typeText('!');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// The exclamation should appear in one of the later blocks
		const hasExcl = source.includes('Block two.!') || source.includes('Block three.!');
		expect(hasExcl).toBe(true);
	});

	test('navigate up then type at start of first block', async () => {
		await editor.loadContent('Hello.\n\nWorld.\n');

		await editor.focusBlockStart(1);
		await editor.pressArrowUp();
		// Sticky column: cursor preserves column 0 across the boundary,
		// landing at START of first block.
		await editor.typeText('hi ');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('hi Hello.');
	});
});

// ── Cross-feature interaction / regression tests ────────────────────
// Structural operations (split, merge, delete) shift block indices and
// blockRefs. These tests verify that subsequent navigation through
// container blocks still works after the shift. New structural operations
// should add a "then navigate through a container" test here.

test.describe('focus traversal after block insertion', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown traverses every block after splitBlock near containers', async () => {
		// Reproduction: splitBlock shifts indices; container blocks (blockquote, list)
		// use their index prop when delegating moveFocus to the parent. If the index
		// prop is stale after the split, focus skips blocks.
		const content = [
			'# Title',
			'',
			'Paragraph before break.',
			'',
			'---',
			'',
			'> Quote line one',
			'>',
			'> Quote line two',
			'',
			'- Item one',
			'- Item two',
			'',
			'```',
			'code here',
			'```',
			'',
			'Final text.',
			''
		].join('\n');

		await editor.loadContent(content);

		// Press Enter at end of "Paragraph before break." to insert a new empty block.
		// This is the structural mutation that triggers the bug.
		await editor.focusBlockEnd(1);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);

		// After split, the document has one more block. Blockquote shifted right by 1.
		// Navigate into the blockquote's last child.
		const bqBlock = editor.getBlock(4);
		const bqEditable = bqBlock.locator('[contenteditable="true"]').last();
		await bqEditable.click();
		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(100);

		// ArrowDown should exit blockquote and enter the list (next top-level block)
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		// Type a marker character to detect where focus landed
		await editor.typeText('Z');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// Z should appear inside the unordered list's first item, NOT in the code block
		// or the final paragraph (which would mean blocks were skipped).
		// Exact column depends on blockquote-vs-list indent offset, so use a relaxed assertion.
		expect(source).toMatch(/- .*Item one.*Z|Z.*Item one/m);
	});

	test('ArrowDown exits list to correct next block after splitBlock', async () => {
		// Tests the list's own index-based moveFocus delegation
		const content = [
			'Some text.',
			'',
			'- Item one',
			'- Item two',
			'',
			'```',
			'code',
			'```',
			'',
			'After code.',
			''
		].join('\n');

		await editor.loadContent(content);

		// Split the first paragraph to shift indices
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);

		// Navigate into the list's last item
		const listBlock = editor.getBlock(2);
		const listEditables = listBlock.locator('[contenteditable="true"]');
		const lastItem = listEditables.last();
		await lastItem.click();
		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(100);

		// ArrowDown should exit the list and enter the code block (next top-level block)
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		// Type in whatever block received focus
		await editor.typeText('Z');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// Z should land inside the fenced code block, NOT in "After code."
		// (which would mean the code block was skipped).
		// focusAtColumn places cursor at the nearest sticky column, which for a
		// high X may land in the code body or on the opener fence.
		expect(source).toMatch(/Z```|```Z|codeZ|Zcode/);
		expect(source).not.toMatch(/ZAfter code/);
	});

	test('ArrowDown traverses correctly after M1 list merge near a container', async () => {
		// Layout: list → code block → final paragraph. Merge two items in the list,
		// then navigate out through the code block to verify container delegation
		// still works after the merge shifted indices inside the list.
		const content = [
			'- Item one',
			'- Item two',
			'',
			'```',
			'code',
			'```',
			'',
			'Final text.',
			''
		].join('\n');

		await editor.loadContent(content);

		// Merge "Item two" into "Item one" via Backspace at start of Item two
		const itemTwo = editor.page.locator('[contenteditable="true"]', { hasText: 'Item two' });
		await itemTwo.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);

		// After M1, the list has one item "Item oneItem two". Navigate from end of list
		// out through the code block and into the final paragraph.
		const listBlock = editor.getBlock(0);
		const listEditable = listBlock.locator('[contenteditable="true"]').first();
		await listEditable.click();
		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(100);

		// ArrowDown should exit the list and enter the code block
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		// Type a marker — it should appear in the code block (first block after list)
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Z should land inside the fenced code block, not in "Final text.".
		// focusAtColumn places cursor at the nearest sticky column, which for a
		// high X may land in the code body or on the opener fence.
		expect(source).toMatch(/Z```|```Z|codeZ|Zcode/);
		expect(source).not.toMatch(/ZFinal/);
	});

	test('ArrowDown traverses correctly after cross-container merge into blockquote', async () => {
		// Layout: blockquote → following paragraph → fenced code → final paragraph.
		// Merge the paragraph into the blockquote, then navigate from blockquote
		// content down through the code block into the final paragraph.
		// Blank-line separator between the blockquote and the following
		// paragraph is required now that lazy continuation is implemented.
		const content = ['> quote line', '', 'text', '', '```', 'code', '```', '', 'Final.', ''].join(
			'\n'
		);

		await editor.loadContent(content);

		// Merge "text" into the blockquote via Backspace at start of "text"
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);

		// After merge, the blockquote contains "quote linetext". Navigate from there
		// through the code block to the final paragraph.
		const bqEditable = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bqEditable.click();
		await editor.pressKey('End');
		await editor.page.waitForTimeout(100);

		// ArrowDown should exit the blockquote and land in the code block
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Z should have landed inside the code block (entering from above).
		// focusAtColumn places cursor at the nearest sticky column, which for a
		// high X may land in the code body or on the opener fence.
		expect(source).toMatch(/Z```|```Z|codeZ|Zcode/);
		expect(source).not.toMatch(/ZFinal/);
		// The merge must still be intact
		expect(source).toContain('> quote linetext');
	});
});

test.describe('geometry-based focus traversal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowUp at top of block moves to previous block', async () => {
		await editor.loadContent('# Title\n\nParagraph text.\n');
		await editor.focusBlock(1, 0);
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(100);
		await editor.typeText('!');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// Sticky column: ArrowUp from column 0 of block 1 preserves column 0,
		// landing at start of block 0. Typing `!` before the `# ` marker turns
		// the heading into a paragraph `!# Title`.
		expect(source).toContain('!# Title');
	});

	test('ArrowDown at end of single-line block moves to next block', async () => {
		await editor.loadContent('First line.\n\nSecond line.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('!');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('!Second line.');
	});
});
