import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { SIMPLE_CONTENT } from '../test-content';
import { FENCE, LAST_CELL, TABLE, filler } from './selection/gap-caret-fixtures';

test.describe('undo and redo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SIMPLE_CONTENT);
	});

	test('undo reverts a split (Enter then Ctrl+Z restores single block)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		expect(await editor.getDomBlockCount()).toBeGreaterThan(3);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('redo restores a split after undo', async () => {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		const splitSource = await editor.bridge.getSource();
		const splitCount = await editor.getDomBlockCount();

		await editor.undo();
		expect(await editor.getDomBlockCount()).toBe(3);

		await editor.redo();
		expect(await editor.bridge.getSource()).toBe(splitSource);
		expect(await editor.getDomBlockCount()).toBe(splitCount);
	});

	test('undo reverts typed text after debounce', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' extra words');
		await editor.bridge.waitForSourceContains(' extra words');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('undo reverts a merge (Backspace at start of block)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');
		expect(await editor.getDomBlockCount()).toBeLessThan(3);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('undo across a paragraph→htmlBlock flip restores the rendered DOM, not just the source', async () => {
		// Typing the last character of `<div` reparses the paragraph as an html block after the browser
		// inserted it, so only a stale DOM would write the undone byte back on the next keystroke.
		await editor.loadContent('<di\n');
		await editor.focusBlockEnd(0);
		await editor.typeText('v');
		await editor.bridge.waitForSourceContains('<div');
		await editor.waitForUndoBatchFlush();
		expect(await editor.bridge.getBlockKind(0)).toBe('htmlBlock');

		await editor.undo();
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.getBlockText(0)).toBe('<di');

		// The undone byte must not come back when the next keystroke reads the DOM.
		await editor.focusBlockEnd(0);
		await editor.typeText('z');
		await editor.bridge.waitForSourceContains('z');
		expect(await editor.bridge.getSource()).not.toContain('div');
	});

	test('undo on empty stack does not crash or corrupt state', async () => {
		const before = await editor.bridge.getSource();
		await editor.undo();
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		await editor.focusBlockEnd(0);
		await editor.typeText('z');
		expect(await editor.getBlockText(0)).toContain('z');
	});
});

test.describe('undo brings an off-screen caret into view', () => {
	let editor: EditorPage;
	const BLOCK = 5;
	const LONG = Array.from({ length: 200 }, (_, i) => `Line ${i} with some words on it.`).join(
		'\n\n'
	);

	/** A block's top below the editor's visible top, or null when it isn't mounted. */
	const topInView = (index: number) =>
		editor.page.evaluate((i) => {
			const view = document.querySelector('.editor') as HTMLElement;
			const block = document.querySelector(`[data-block-path='[${i}]']`);
			if (!block) return null;
			return block.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientTop;
		}, index);

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(LONG + '\n');
		await editor.page.locator(`[data-block-path='[${BLOCK}]'] [contenteditable="true"]`).click();
		await editor.page.keyboard.press('End');
		await editor.typeText('x');
		await editor.waitForUndoBatchFlush();
		const box = (await editor.editorContainer.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	});

	test('a caret whose block scrolled out of the window lands at the top edge', async ({ page }) => {
		const block = page.locator(`[data-block-path='[${BLOCK}]']`);
		for (let i = 0; i < 20 && (await block.count()) > 0; i++) {
			await page.mouse.wheel(0, 600);
			await editor.waitForRenderFlush();
		}
		await expect(block).toHaveCount(0);

		await editor.undo();
		await editor.bridge.waitForSourceContains(`Line ${BLOCK} with some words on it.\n`);
		await expect(block).toBeInViewport();
		expect(Math.abs((await topInView(BLOCK))!)).toBeLessThanOrEqual(2);
	});

	test('a caret whose block sits just above the viewport lands at the top edge, not the middle', async ({
		page
	}) => {
		// Wheeled until the block's bottom has just left the top edge, still inside the band windowing
		// mounts ahead.
		for (let i = 0; i < 40; i++) {
			const top = await topInView(BLOCK);
			const height = await page
				.locator(`[data-block-path='[${BLOCK}]']`)
				.evaluate((el) => el.getBoundingClientRect().height);
			if (top !== null && top + height < 0) break;
			await page.mouse.wheel(0, 40);
			await editor.waitForRenderFlush();
		}
		await expect(page.locator(`[data-block-path='[${BLOCK}]']`)).toBeAttached();
		await expect(page.locator(`[data-block-path='[${BLOCK}]']`)).not.toBeInViewport();

		await editor.undo();
		await editor.bridge.waitForSourceContains(`Line ${BLOCK} with some words on it.\n`);
		await editor.waitForRenderFlush();
		expect(Math.abs((await topInView(BLOCK))!)).toBeLessThanOrEqual(2);
	});

	test('a gap caret between a table and a fence, scrolled away, comes back into view', async ({
		page
	}) => {
		await editor.loadContent(`${filler(30, 0)}\n${TABLE}\n${FENCE}\n${filler(80, 30)}`);
		await page.evaluate(() => (window as any).__test.rects.reveal([30]));
		await editor.waitForRenderFlush();
		await page.locator('.table-cell').nth(LAST_CELL).click();
		await page.keyboard.press('ArrowDown');
		const gap = { parentPath: [], index: 31 };
		await editor.bridge.waitForGapCaret(gap);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('\nx\n');
		await editor.waitForUndoBatchFlush();

		for (let i = 0; i < 20 && (await page.locator('.table-cell').count()) > 0; i++) {
			await page.mouse.wheel(0, 600);
			await editor.waitForRenderFlush();
		}
		await expect(page.locator('.table-cell')).toHaveCount(0);

		await editor.undo();
		await editor.bridge.waitForGapCaret(gap);
		await expect(page.locator('[data-gap-caret]')).toBeInViewport();
	});
});
