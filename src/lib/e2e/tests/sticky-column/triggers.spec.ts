/**
 * Sticky column — which actions reset vs preserve the captured column.
 * See e2e/requirements/sticky-column.md.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: reset triggers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Helper: navigate into a long block, capture sticky at a high column
	async function setupHighColumn() {
		await editor.loadContent(
			'A long first paragraph with enough text to have a high-column position.\n\nShort.\n\nAnother long paragraph to test landing at the original column.\n'
		);
		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 30; i++) await editor.page.keyboard.press('ArrowRight');
	}

	test('typing resets sticky column', async () => {
		await setupHighColumn();
		await editor.pressArrowDown(); // Captures sticky
		await editor.page.waitForTimeout(50);

		// Type a character — should reset
		await editor.typeText('x');
		await editor.page.waitForTimeout(100);

		// Now ArrowDown to the third block. Without sticky reset, cursor would
		// land at the captured X. With reset, cursor is wherever typing left it
		// (end of "x" on line 2), and the target in line 3 is near there.
		const preArrowX = await editor.getCaretPixelX();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// After reset, the new capture (on this ArrowDown) is from preArrowX.
		// The target block's cursor should be near preArrowX, not near the original high column.
		expect(Math.abs(targetX - preArrowX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('click resets sticky column', async () => {
		await setupHighColumn();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);

		// Click somewhere different — a low column in the second block
		const second = editor.page.locator('[contenteditable="true"]').nth(1);
		await second.click();
		await editor.page.keyboard.press('Home');

		const postClickX = await editor.getCaretPixelX();

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// Target should be near the post-click column, not the original high column
		expect(Math.abs(targetX - postClickX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('ArrowLeft resets sticky column', async () => {
		await setupHighColumn();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);

		// ArrowLeft — moves cursor one character left, resets sticky
		await editor.page.keyboard.press('ArrowLeft');
		await editor.page.waitForTimeout(50);

		const postArrowLeftX = await editor.getCaretPixelX();

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// Target should be near the post-left-arrow column
		expect(Math.abs(targetX - postArrowLeftX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('ArrowRight resets sticky column', async () => {
		await setupHighColumn();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('ArrowRight');
		await editor.page.waitForTimeout(50);

		const postRightX = await editor.getCaretPixelX();

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// * 4 rather than * 3: after ArrowRight lands at offset 1 of "Short.", the
		// nearest character in the long third block is one full character-width away,
		// which causes a ~17px snap gap in the proportional font. The sticky IS reset
		// (if not, the gap would be ~200px); the wider bound accommodates the snap.
		expect(Math.abs(targetX - postRightX)).toBeLessThan(PIXEL_TOLERANCE * 4);
	});

	test('End resets sticky column', async () => {
		await setupHighColumn();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(50);

		const postEndX = await editor.getCaretPixelX();

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// After End, we're at end of the short line. After ArrowDown, we should
		// land near that column in the long line, not at the original high column.
		expect(Math.abs(targetX - postEndX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('Enter (split) resets sticky column', async () => {
		await setupHighColumn();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);

		// Enter splits the block at the current cursor
		await editor.pressEnter();
		await editor.page.waitForTimeout(100);

		// After Enter, cursor is at offset 0 of the new block
		const postEnterX = await editor.getCaretPixelX();

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// Target should be near the post-enter column (near left edge), not the original high column
		expect(Math.abs(targetX - postEnterX)).toBeLessThan(PIXEL_TOLERANCE * 5);
	});

	test('undo resets sticky column', async () => {
		await setupHighColumn();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);

		await editor.pressEnter();
		await editor.page.waitForTimeout(100);
		// Ctrl+Z to undo the split
		await editor.page.keyboard.press('Control+z');
		await editor.page.waitForTimeout(100);

		// After undo, stickyX should be reset (via undo action reset hook).
		// Cursor lands at the undo snapshot focus. Verify by typing a marker.
		const postUndoX = await editor.getCaretPixelX();

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postUndoX)).toBeLessThan(PIXEL_TOLERANCE * 5);
	});
});

test.describe('sticky column: preserve triggers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown preserves sticky column', async () => {
		await editor.loadContent(
			'First long line with text.\n\nSecond long line with text.\n\nThird long line here.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 15; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		// Shift+ArrowDown extends selection inside the first block (no cross-block)
		// but should NOT reset sticky column — Shift+Arrow is in the preserve list,
		// matching standard editor behavior (VS Code, Google Docs, Word).
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.page.waitForTimeout(50);

		// Plain ArrowDown to cross blocks — sticky should still apply.
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// The sticky X should still apply — cursor should be near sourceX column,
		// not at an arbitrary position influenced by the selection extension.
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});
});
