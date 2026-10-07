import { test, expect } from '../../fixtures';
import { BlockMathPage, MathRevealPage } from './latex-reveal-helpers';
import { MermaidPage } from './mermaid-helpers';
import type { PluginsPage } from './helpers';

// An edit held outside the document (a shown formula source, a diagram's edit box) belongs to the
// document it was opened on: a `source` swap drops it, and it never lands in the incoming one.
// Requirements: e2e/requirements/plugins/draft-across-swap.md.

/** Swap to `next` with the outgoing draft still open, then let the teardown's blur run out. */
async function swapWithDraftOpen(editor: PluginsPage, next: string): Promise<string[]> {
	await editor.page.evaluate(() => (window as any).__test.startEditOpCapture());
	await editor.page.evaluate((md) => (window as any).__test.setSource(md), next);
	await editor.waitForRenderFlush();
	await editor.waitForRenderFlush();
	return editor.page.evaluate(() => (window as any).__test.stopEditOpCapture());
}

test.describe('a draft held outside the document across a source swap', () => {
	test('a shown block-math source is dropped, not written into the next document', async ({
		page
	}) => {
		const editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathblock');
		await editor.revealByClick();
		await page.keyboard.type('xyz');

		const next = 'Other\n\nparagraph two\n\nthree\n';
		const ops = await swapWithDraftOpen(editor, next);

		expect(await editor.bridge.getSource()).toBe(next);
		expect(ops).toEqual([]);
	});

	test('a shown inline formula is dropped, not written into the next document', async ({
		page
	}) => {
		const editor = new MathRevealPage(page);
		await editor.gotoPlugins('math-two');
		await editor.mathWidget.first().click();
		await expect(editor.mathWidget).toHaveCount(1);
		await page.keyboard.type('qq');

		const next = 'Other note entirely\n\nsecond paragraph\n';
		const ops = await swapWithDraftOpen(editor, next);

		expect(await editor.bridge.getSource()).toBe(next);
		expect(ops).toEqual([]);
	});

	test('a diagram’s edit box is dropped, not written into the next document', async ({ page }) => {
		const editor = new MermaidPage(page);
		await editor.gotoPlugins('mermaid');
		await editor.loadDiagram('Above\n\n```mermaid\ngraph TD\n```\n\ntail\n');
		await editor.block.hover();
		await editor.block.getByTestId('mermaid-edit').click();
		await expect(editor.textarea).toBeFocused();
		await page.keyboard.press('End');
		await page.keyboard.type('\nA --> B');

		const next = 'Below\n\n```mermaid\ngraph LR\n```\n\nend\n';
		const ops = await swapWithDraftOpen(editor, next);

		expect(await editor.bridge.getSource()).toBe(next);
		expect(ops).toEqual([]);
	});

	test('a mode change commits a shown block-math source once', async ({ page }) => {
		const editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathblock');
		await editor.setPresentationMode('live');
		await editor.revealByClick();
		await page.keyboard.type('y');
		const typed = await editor.sourceText();
		await page.evaluate(() => (window as any).__test.startEditOpCapture());

		await editor.setPresentationMode('source');
		await editor.waitForRenderFlush();

		await editor.bridge.waitForSourceEquals(`Before\n\n${typed}\n\nAfter\n`);
		const ops: string[] = await page.evaluate(() => (window as any).__test.stopEditOpCapture());
		expect(ops).toHaveLength(1);
	});
});
