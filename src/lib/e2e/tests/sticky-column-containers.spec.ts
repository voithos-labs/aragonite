/**
 * Sticky column — container traversal, transparent blocks, and edge cases.
 * See e2e/requirements/sticky-column.md. Code-block entry symmetry lives in
 * sticky-column-code-block-entry.spec.ts.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

const PIXEL_TOLERANCE = 5;

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

test.describe('sticky column: transparent blocks', () => {
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
});

// Code block entry behavior is pinned by sticky-column-code-block-entry.spec.ts.
// The pre-0.3.5 "code block is opaque" test that used to live here asserted the
// cursor landed at the left edge on entry — a claim that happened to stay true
// only because short opener/closer fence lines clamp any high sticky X. The
// participating-block semantics are exercised more precisely there.

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
