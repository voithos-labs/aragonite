import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// Keyboard behavior inside a code block that diverges from text-block parity:
// bold/italic shortcuts are no-ops, horizontal-arrow focus exit, sticky-column
// preservation across the code block, and Shift+Enter literal-newline (no br).

test.describe('code block keyboard — beyond parity', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+B inside a code block is a no-op', async ({ page }) => {
		await editor.loadContent('```js\nconst x = 42;\n```\n');
		await editor.getBlock(0).click();
		const sourceBefore = await editor.bridge.getSource();
		await page.keyboard.press('Control+b');
		await page.waitForTimeout(50);
		const sourceAfter = await editor.bridge.getSource();
		expect(sourceAfter).toBe(sourceBefore);
		expect(await editor.getBlock(0).locator('b').count()).toBe(0);
		expect(await editor.getBlock(0).locator('strong').count()).toBe(0);
	});

	test('Ctrl+I inside a code block is a no-op', async ({ page }) => {
		await editor.loadContent('```js\nconst x = 42;\n```\n');
		await editor.getBlock(0).click();
		const sourceBefore = await editor.bridge.getSource();
		await page.keyboard.press('Control+i');
		await page.waitForTimeout(50);
		const sourceAfter = await editor.bridge.getSource();
		expect(sourceAfter).toBe(sourceBefore);
		expect(await editor.getBlock(0).locator('i').count()).toBe(0);
		expect(await editor.getBlock(0).locator('em').count()).toBe(0);
	});

	test('ArrowLeft at offset 0 moves focus to previous block', async ({ page }) => {
		await editor.loadContent('text above\n\n```\ncode\n```\n');
		await editor.getBlock(1).click();
		await editor.focusBlockStart(1);
		await page.keyboard.press('ArrowLeft');
		await page.waitForTimeout(50);
		await editor.typeText('X');
		const source = await editor.bridge.getSource();
		expect(source.split('\n')[0]).toContain('X');
	});

	test('ArrowRight at end of content moves focus to next block', async ({ page }) => {
		await editor.loadContent('```\ncode\n```\n\ntext below\n');
		await editor.getBlock(0).click();
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(50);
		await editor.typeText('X');
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/Xtext below/);
	});

	test('vertical arrow sticky column preserved through code block', async ({ page }) => {
		await editor.loadContent(
			'aaaaaaaaaaaaaaaaaaaaaaaaaaa\n\n```\nshort\nshort\n```\n\nbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
		);

		await editor.getBlock(0).click();
		await page.keyboard.press('Home');
		for (let i = 0; i < 20; i++) {
			await page.keyboard.press('ArrowRight');
		}

		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);
		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);
		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);
		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);

		await editor.typeText('X');
		const source = await editor.bridge.getSource();
		const lastParagraph = source.split('\n\n').pop() ?? '';

		const xIndex = lastParagraph.indexOf('X');
		expect(xIndex).toBeGreaterThanOrEqual(15);
		expect(xIndex).toBeLessThanOrEqual(25);
	});

	test('Shift+Enter inserts \\n, not <br>', async ({ page }) => {
		await editor.loadContent('```\nfirst line\n```\n');
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.typeText('second line');
		await page.waitForTimeout(100);

		const source = await editor.bridge.getSource();
		expect(source).toContain('first line\nsecond line');

		expect(await editor.getBlock(0).locator('br').count()).toBe(0);
	});
});
