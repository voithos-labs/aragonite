import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: reset triggers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The column a sticky-reset landing must snap back to. The trailing paragraph guarantees a
	// downward move lands in a REAL block rather than the past-end append, whose degenerate caret
	// collapses to x≈0.
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

	/** Park the high column on the short line, where every reset gesture below fires. */
	async function clampOntoShortLine(): Promise<number> {
		const baseColumnX = await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		return baseColumnX;
	}

	// Each gesture leaves the caret where the next ArrowDown must land, so the reference is the
	// gesture's own caret and the tolerance is the measurement's.
	const CASES = [
		{
			name: 'typing',
			reset: async () => {
				await editor.typeText('x');
				await editor.waitForRenderFlush();
			},
			tolerance: PIXEL_TOLERANCE * 3
		},
		{
			name: 'click',
			reset: async () => {
				await editor.page.locator('[contenteditable="true"]').nth(1).click();
				await editor.page.keyboard.press('Home');
			},
			tolerance: PIXEL_TOLERANCE * 3
		},
		{
			name: 'ArrowLeft',
			reset: async () => {
				await editor.page.keyboard.press('ArrowLeft');
				await editor.waitForRenderFlush();
			},
			tolerance: PIXEL_TOLERANCE * 3
		},
		{
			name: 'End',
			reset: async () => {
				await editor.page.keyboard.press('End');
				await editor.waitForRenderFlush();
			},
			tolerance: PIXEL_TOLERANCE * 3
		},
		{
			name: 'undo',
			reset: async () => {
				await editor.page.keyboard.press('Enter');
				await editor.waitForRenderFlush();
				await editor.undo();
				await editor.waitForRenderFlush();
			},
			tolerance: PIXEL_TOLERANCE * 5
		}
	];

	for (const { name, reset, tolerance } of CASES) {
		test(`${name} resets sticky column`, async () => {
			await clampOntoShortLine();

			await reset();
			const resetColumnX = await editor.getCaretPixelX();

			await editor.page.keyboard.press('ArrowDown');
			await editor.waitForRenderFlush();

			const targetX = await editor.getCaretPixelX();
			expect(Math.abs(targetX - resetColumnX)).toBeLessThan(tolerance);
		});
	}

	// The two gestures whose own caret is not a usable reference, so the landing answers to the
	// document's left column instead. Reset → ~0 gap; no reset → ~280.
	test('ArrowRight resets sticky column', async () => {
		const baseColumnX = await clampOntoShortLine();

		await editor.page.keyboard.press('ArrowRight');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - baseColumnX)).toBeLessThan(PIXEL_TOLERANCE * 2);
	});

	test('Enter (split) resets sticky column', async () => {
		const baseColumnX = await clampOntoShortLine();

		// The post-Enter caret sits in the new empty paragraph (no client rect → x≈0), which is
		// why the landing is measured against the left column rather than that degenerate caret.
		await editor.page.keyboard.press('Enter');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - baseColumnX)).toBeLessThan(PIXEL_TOLERANCE * 2);
	});
});
