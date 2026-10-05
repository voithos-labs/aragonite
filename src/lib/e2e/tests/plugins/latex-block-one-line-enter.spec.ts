import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

// A line break typed into a one-line `$$x^2$$` turns it into the multi-line form, on screen and in
// the bytes, so a reload reads the same document the editor shows.
// Requirements: e2e/requirements/plugins/latex-block-one-line-enter.md.

const DOC = 'Before\n\n$$x^2$$\n\nAfter\n';

test.describe('Enter in a one-line math block', () => {
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathblock');
	});

	for (const mode of ['live', 'source'] as const) {
		test(`Enter at the body's end opens a body line under it (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.revealByClick();
			await page.keyboard.press('End');
			// Source mode paints the closer, so End lands past it; two steps back is the body's end.
			if (mode === 'source') {
				await page.keyboard.press('ArrowLeft');
				await page.keyboard.press('ArrowLeft');
			}

			await page.keyboard.press('Enter');
			await page.keyboard.type('y');

			await expect.poll(() => editor.sourceText()).toBe('$$\nx^2\ny\n$$');
			await editor.getBlock(2).click();
			await editor.bridge.waitForSourceEquals('Before\n\n$$\nx^2\ny\n$$\n\nAfter\n');
			expect(await editor.bridge.getBlockKind(1)).toBe('mathBlock');
			expect(await roundTripStable(page)).toBe(true);
		});
	}

	// Backspace in an empty paragraph under a math block keeps the paragraph and moves the caret to
	// the end of the formula, which is where Enter used to double the closer.
	test('Backspace from the emptied paragraph below, then Enter, keeps one block', async ({
		page
	}) => {
		await editor.setPresentationMode('live');
		await editor.getBlock(2).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Home');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('Before\n\n$$x^2$$\n\n\n');

		await page.keyboard.press('Backspace');
		await expect(editor.source).toBeFocused();
		await page.keyboard.press('Enter');
		await page.keyboard.type('y');
		await expect.poll(() => editor.sourceText()).toBe('$$\nx^2\ny\n$$');

		await editor.getBlock(0).click();
		await editor.bridge.waitForSourceEquals('Before\n\n$$\nx^2\ny\n$$\n\n\n');
		expect(await editor.bridge.getBlockKind(1)).toBe('mathBlock');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('undo after the blur puts the one-line form back in one step', async ({ page }) => {
		await editor.setPresentationMode('live');
		await editor.revealByClick();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceEquals('Before\n\n$$\nx^2\n\n$$\n\nAfter\n');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(DOC);
	});
});
