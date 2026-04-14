/**
 * Sticky column — cross-block caret column memory.
 *
 * Assertions use a small pixel tolerance because proportional fonts mean the
 * target offset's pixel X may not exactly equal the source X — we accept the
 * nearest-offset landing position.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: basic capture and cross-block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown preserves column when moving from long line to long line', async () => {
		await editor.loadContent(
			'Hello world this is the first paragraph.\n\nSecond paragraph is also quite long.\n'
		);

		// Click into the first paragraph at around offset 10 (after "Hello worl")
		const firstPara = editor.page.locator('[contenteditable="true"]').first();
		await firstPara.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 10; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();
		expect(sourceX).toBeGreaterThan(0);

		// ArrowDown to second paragraph
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('ArrowUp preserves column when moving from long line to long line', async () => {
		await editor.loadContent(
			'Hello world this is the first paragraph.\n\nSecond paragraph is also quite long.\n'
		);

		// Click into the second paragraph at around offset 10
		const secondPara = editor.page.locator('[contenteditable="true"]').nth(1);
		await secondPara.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 10; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});
});

test.describe('sticky column: survive intermediate clamping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown through a short block preserves original column in the next long block', async () => {
		await editor.loadContent(
			'A very long first paragraph with plenty of characters to start at a high column.\n\nShort.\n\nAnother long paragraph here with many characters to land in.\n'
		);

		// Click into first paragraph at a high column (around offset 40)
		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 40; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();
		expect(sourceX).toBeGreaterThan(100); // Just verifying we're at a reasonably high column

		// ArrowDown to "Short." — cursor will clamp to end of "Short."
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		// ArrowDown to "Another long paragraph..." — cursor should return to original column
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('ArrowDown through multiple short blocks preserves original column in the final long block', async () => {
		await editor.loadContent(
			'Long line one with plenty of text to start at a high column position.\n\nA.\n\nB.\n\nC.\n\nAnother very long line with many characters near the far side.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 40; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		// ArrowDown 4 times to traverse through A, B, C to the final long line
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(50);
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});
});

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

test.describe('sticky column: container traversal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('through blockquote preserves column', async () => {
		await editor.loadContent(
			'Long first paragraph with plenty of characters.\n\n> Quote line with text here.\n\nAnother long paragraph after the quote.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 20; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		// ArrowDown into the blockquote's inner paragraph
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		const insideX = await editor.getCaretPixelX();
		// Cursor lands near sourceX (minus the blockquote's left border/padding, but
		// for now we care that sticky applied — loose tolerance)
		expect(Math.abs(insideX - sourceX)).toBeLessThan(30); // Allow for blockquote indent

		// ArrowDown out of the blockquote into the next paragraph
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		const afterX = await editor.getCaretPixelX();
		expect(Math.abs(afterX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('through list preserves column', async () => {
		await editor.loadContent(
			'Long first paragraph with enough characters.\n\n- Item one with text\n- Item two with text\n- Item three with text\n\nAfter the list long paragraph.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 15; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		// ArrowDown four times: into list items then out
		await editor.pressArrowDown(); // Item one
		await editor.page.waitForTimeout(50);
		await editor.pressArrowDown(); // Item two
		await editor.page.waitForTimeout(50);
		await editor.pressArrowDown(); // Item three
		await editor.page.waitForTimeout(50);
		await editor.pressArrowDown(); // After list
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// The final paragraph is a top-level prose block — column should be preserved
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});
});

test.describe('sticky column: opaque and transparent blocks', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('thematic break is transparent — column preserved through ---', async () => {
		await editor.loadContent(
			'Long paragraph before thematic break with lots of text.\n\n---\n\nLong paragraph after the thematic break with lots of text.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 25; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		// ArrowDown onto thematic break (block-highlight focus)
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		// ArrowDown through thematic break into next paragraph
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('code block is opaque — cursor lands at left edge on entry', async () => {
		await editor.loadContent(
			'Long paragraph with plenty of text to start at a high column.\n\n```\ncode content\n```\n\nAnother long paragraph after.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 25; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		// ArrowDown into code block
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		// The code block is opaque — cursor lands at textarea offset 0, NOT at sticky X.
		// Verify the cursor is on the left side of the code block, not at the original column.
		const insideX = await editor.getCaretPixelX();
		expect(insideX).toBeLessThan(sourceX - 20);
	});
});

test.describe('sticky column: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('capture in empty paragraph does not crash', async () => {
		await editor.loadContent('Above.\n\n\n\nBelow paragraph with text.\n');

		// Click into the empty middle paragraph if it exists; the parser may
		// represent the blank line differently, so this test verifies the
		// capture helper handles empty blocks gracefully.
		const editables = editor.page.locator('[contenteditable="true"]');
		const count = await editables.count();
		if (count >= 3) {
			await editables.nth(1).click();
			// ArrowDown — captures X at the empty block's left edge
			await editor.pressArrowDown();
			await editor.page.waitForTimeout(100);

			// Cursor should be near offset 0 of the next block (empty block
			// has no content, so sticky X is near the left edge).
			const targetX = await editor.getCaretPixelX();
			const below = editables.nth(count - 1);
			const belowRect = await below.boundingBox();
			if (belowRect) {
				// targetX should be near the left edge of the below block
				expect(Math.abs(targetX - belowRect.x)).toBeLessThan(20);
			}
		}
	});

	test('editor blur resets sticky column — blur, re-focus, fresh capture', async () => {
		await editor.loadContent(
			'Long first paragraph with plenty of characters.\n\nSecond long paragraph here.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 20; i++) await editor.page.keyboard.press('ArrowRight');

		await editor.pressArrowDown(); // Captures sticky at high column
		await editor.page.waitForTimeout(100);

		// Blur the editor by focusing the body element (forces focusout from the editor)
		await editor.page.evaluate(() => (document.body as HTMLElement).focus());
		await editor.page.waitForTimeout(100);

		// Re-focus the editor by clicking at a low column
		await first.click();
		await editor.page.keyboard.press('Home');
		const postRefocusX = await editor.getCaretPixelX();

		// Next ArrowDown should capture fresh from postRefocusX (not use stale sticky)
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// Target should be near postRefocusX, not at the original high column
		expect(Math.abs(targetX - postRefocusX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});
});

test.describe('sticky column: rapid cross-block navigation (timing)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Tests that consecutive vertical-arrow presses without any settling time
	// still cross block boundaries correctly. A bug in isAtFirstVisualLine /
	// isAtLastVisualLine causes the handler to miss the "at boundary" signal
	// under rapid input when the block's firstChild/lastChild is a non-text
	// node (headings have a marker span as firstChild; inline markup blocks
	// have markup spans at one or both ends). When the check returns false
	// incorrectly, the browser's native ArrowUp/ArrowDown runs, which for
	// single-line blocks moves the cursor to offset 0 / textLen of the SAME
	// block instead of crossing the boundary.
	//
	// Assertion strategy: type a marker character after rapid navigation,
	// then check which line of the source contains the marker. If the
	// cursor didn't cross as many blocks as it should have, the marker
	// lands in the wrong line.

	test('rapid ArrowUp across headings crosses to the first heading', async () => {
		await editor.loadContent('# Heading 1\n\n## Heading 2\n\n### Heading 3\n');
		const h3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await h3.click();
		await editor.page.keyboard.press('End');

		// Two consecutive presses with no settling time — should cross H3→H2→H1
		await editor.pressArrowUp();
		await editor.pressArrowUp();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		// After 2 Ups from H3, cursor should be somewhere in H1 (line 0)
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across headings crosses to the last heading', async () => {
		await editor.loadContent('# Heading 1\n\n## Heading 2\n\n### Heading 3\n');
		const h1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await h1.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowDown();
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		// Lines: ['# Heading 1', '', '## Heading 2', '', '### Heading 3', '']
		// After 2 Downs from H1, cursor should be in H3 (line 4)
		expect(lines[4]).toContain('X');
	});

	test('rapid ArrowUp across plain paragraphs crosses to the first', async () => {
		await editor.loadContent('Para one.\n\nPara two.\n\nPara three.\n');
		const p3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await p3.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowUp();
		await editor.pressArrowUp();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across plain paragraphs crosses to the last', async () => {
		await editor.loadContent('Para one.\n\nPara two.\n\nPara three.\n');
		const p1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await p1.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowDown();
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[4]).toContain('X');
	});

	test('rapid ArrowUp across paragraphs whose first child is a markup span', async () => {
		// DOM: firstChild is the dimmed `**` marker span (non-text).
		// This should exercise the same isAtFirstVisualLine fragile path as headings.
		await editor.loadContent(
			'**bold one** rest of para.\n\n**bold two** rest of para.\n\n**bold three** rest of para.\n'
		);
		const p3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await p3.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowUp();
		await editor.pressArrowUp();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across paragraphs whose last child is a markup span', async () => {
		// DOM: lastChild is the dimmed `**` marker span (non-text).
		// This should exercise the isAtLastVisualLine fragile path.
		await editor.loadContent(
			'rest of para **bold one**\n\nrest of para **bold two**\n\nrest of para **bold three**\n'
		);
		const p1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await p1.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowDown();
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[4]).toContain('X');
	});
});
