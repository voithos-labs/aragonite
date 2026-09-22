import { test, expect } from '../../fixtures';
import { roundTripStable, waitForDoc, activeBlockPath } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

/**
 * Committing block math (requirements/plugins/latex-block-commit-split.md): an open source
 * committed with text that parses to several blocks must split the document again, which is what
 * a stuck fence comes from. Real keyboard and mouse only; Enter inside the source inserts a
 * literal newline and never splits as you type, so the split happens when blur commits. Deleting
 * the fences here converts the block because the user addressed those bytes; a truncation written
 * past this element puts the closer back (latex-block-live-editing.spec.ts).
 */

test.describe('block math commit core: multi-block source re-splits', () => {
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathblock');
	});

	test('editing past the fence re-splits into math + paragraph on blur: no stuck error', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('hello');
		// Blur by clicking the paragraph above → one commit.
		await editor.getBlock(0).click();

		const doc = await waitForDoc(page, (s) => s.rootCount === 4);
		expect(doc.kinds).toEqual(['paragraph', 'mathBlock', 'paragraph', 'paragraph']);
		expect(doc.texts[1]).toBe('$$x^2$$');
		expect(doc.texts[2]).toBe('hello');
		// The math went back to a clean render, so the stuck state is gone.
		await expect(editor.renderedKatex).toHaveCount(1);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the blur-commit lands the caret at the edit position, alive and deterministic', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('hello');
		// Re-laying out while the block closes consumes the click's own focus, which Chromium
		// drops to <body>, so the commit puts the caret back at the edit position in the
		// split-off paragraph rather than leaving no caret at all.
		await editor.getBlock(0).click();

		await waitForDoc(page, (s) => s.rootCount === 4);
		await editor.waitForRenderFlush();
		expect(await activeBlockPath(page)).toEqual([2]);
	});

	test('deleting both fences converts the block to a paragraph on blur', async ({ page }) => {
		await editor.revealByClick();
		// `$$x^2$$` → `x^2`: strip the trailing then leading fence by keyboard.
		await page.keyboard.press('End');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Home');
		await page.keyboard.press('Delete');
		await page.keyboard.press('Delete');
		await editor.getBlock(0).click();

		const doc = await waitForDoc(page, (s) => s.kinds[1] === 'paragraph');
		expect(doc.rootCount).toBe(3);
		expect(doc.texts[1]).toBe('x^2');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('undo after the split restores the single math block in one step', async ({ page }) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('hello');
		await editor.getBlock(0).click();
		await waitForDoc(page, (s) => s.rootCount === 4);

		await editor.undo();
		const doc = await waitForDoc(page, (s) => s.rootCount === 3);
		expect(doc.kinds).toEqual(['paragraph', 'mathBlock', 'paragraph']);
		expect(doc.texts[1]).toBe('$$x^2$$');
	});
});
