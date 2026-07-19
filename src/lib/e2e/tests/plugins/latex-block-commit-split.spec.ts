import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, waitForDoc, activeBlockPath } from './helpers';

/**
 * Block math commit kernel (requirements/plugins/latex-block-commit-split.md):
 * a revealed source committed with text that parses to multiple blocks must
 * re-split the document — the stuck-fence class. Real keyboard/mouse only;
 * Enter inside the source inserts a literal newline (never splits live), so
 * the split happens at blur-commit time.
 */

class BlockMathCommitPage extends PluginsPage {
	get render() {
		return this.page.locator('.math-block-render');
	}

	get source() {
		return this.page.locator('.math-block-source');
	}

	get renderedKatex() {
		return this.page.locator('.math-block-render .katex');
	}

	async gotoSeed(): Promise<void> {
		await this.gotoPlugins('mathblock');
		await expect(this.render).toHaveCount(1);
	}

	async revealByClick(): Promise<void> {
		await this.render.click();
		await expect(this.source).toHaveCount(1);
		await this.waitForRenderFlush();
	}
}

test.describe('block math commit kernel: multi-block source re-splits', () => {
	let editor: BlockMathCommitPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathCommitPage(page);
		await editor.gotoSeed();
	});

	test('editing past the fence re-splits into math + paragraph on blur — no stuck error', async ({
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
		// The math folded back to a clean render — the stuck state is gone.
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
		// The fold's relayout during the click consumes the click's own focus
		// (Chromium drops it to <body>), so the commit restores the caret to the
		// edit position in the split-off paragraph — never a dead caret.
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
