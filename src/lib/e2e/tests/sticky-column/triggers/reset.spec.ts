import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: reset triggers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Returns the document's left text column X (caret at offset 0, measured on a
	// non-empty paragraph), the column a sticky-reset landing must snap back to. The
	// trailing paragraph guarantees a downward move out of para3 lands in a real
	// block instead of the past-end paragraph-append (which leaves a degenerate caret
	// whose getClientRects collapses to x≈0).
	async function setupHighColumn(): Promise<number> {
		await editor.loadContent(
			'A long first paragraph with enough text to have a high-column position.\n\n' +
				'Short.\n\n' +
				'Another long paragraph to test landing at the original column.\n\n' +
				'A trailing paragraph so a downward move always lands in a real block.\n'
		);
		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		const baseColumnX = await editor.getCaretPixelX();
		for (let i = 0; i < 30; i++) await editor.page.keyboard.press('ArrowRight');
		return baseColumnX;
	}

	test('typing resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		await editor.typeText('x');
		await editor.waitForRenderFlush();

		const preArrowX = await editor.getCaretPixelX();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - preArrowX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('click resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const second = editor.page.locator('[contenteditable="true"]').nth(1);
		await second.click();
		await editor.page.keyboard.press('Home');

		const postClickX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postClickX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('ArrowLeft resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowLeft');
		await editor.waitForRenderFlush();

		const postArrowLeftX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postArrowLeftX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('ArrowRight resets sticky column', async () => {
		const baseColumnX = await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown'); // high sticky X clamps onto the short line
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowRight'); // must reset the sticky column
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowDown'); // lands at the reset column, not the high one
		await editor.waitForRenderFlush();

		// Sticky reset → the downward move lands back at the document's left column.
		// Were it NOT reset, it would land ~280px in, at the remembered high column.
		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - baseColumnX)).toBeLessThan(PIXEL_TOLERANCE * 2);
	});

	test('End resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('End');
		await editor.waitForRenderFlush();

		const postEndX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postEndX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('Enter (split) resets sticky column', async () => {
		const baseColumnX = await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown'); // high sticky X clamps onto the short line
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('Enter'); // split must reset the sticky column
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowDown'); // lands at the reset column, not the high one
		await editor.waitForRenderFlush();

		// The post-Enter caret sits in the new empty paragraph (no client rect → x≈0),
		// so assert the downward landing against the reliably-measured left column
		// rather than that degenerate reference. Reset → ~0 gap; no reset → ~280.
		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - baseColumnX)).toBeLessThan(PIXEL_TOLERANCE * 2);
	});

	test('undo resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('Enter');
		await editor.waitForRenderFlush();
		await editor.undo();
		await editor.waitForRenderFlush();

		const postUndoX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postUndoX)).toBeLessThan(PIXEL_TOLERANCE * 5);
	});
});
