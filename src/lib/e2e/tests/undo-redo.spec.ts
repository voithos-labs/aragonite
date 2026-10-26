import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { SIMPLE_CONTENT } from '../test-content';
import { FENCE, LAST_CELL, TABLE, filler } from './selection/gap-caret-fixtures';
import { edgeKey } from '../platform-keys';
import { clickInPlace } from '../click-in-place';

test.describe('undo and redo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SIMPLE_CONTENT);
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
		await expect.poll(() => editor.bridge.getBlockKind(0)).toBe('htmlBlock');

		await editor.undo();
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.getBlockText(0)).toBe('<di');

		// The undone byte must not come back when the next keystroke reads the DOM.
		await editor.focusBlockEnd(0);
		await editor.typeText('z');
		await editor.bridge.waitForSourceContains('z');
		expect(await editor.bridge.getSource()).not.toContain('div');
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
		await clickInPlace(
			editor.page.locator(`[data-block-path='[${BLOCK}]'] [contenteditable="true"]`)
		);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.typeText('x');
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
		await clickInPlace(page.locator('.table-cell').nth(LAST_CELL));
		await page.keyboard.press('ArrowDown');
		const gap = { parentPath: [], index: 31 };
		await editor.bridge.waitForGapCaret(gap);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('\nx\n');

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

test.describe('undo shows the caret’s line in a block taller than the screen', () => {
	const TALL = 10;
	const DOC =
		Array.from({ length: 60 }, (_, i) =>
			i === TALL
				? `Tall ${'paragraph that wraps onto line after line, '.repeat(160)}`
				: `Line ${i} with some words on it.`
		).join('\n\n') + '\n';

	// Miss-analysis: every undo row used a short block, where showing the block shows the caret,
	// so a caret deep in a tall block whose top was on screen stayed below the edge.
	test('undo with the caret at the end of a tall paragraph whose top is on screen', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
		await editor.focusBlockEnd(TALL);
		await editor.typeText('x');
		await editor.bridge.waitForSourceContains('line after line, x');
		// The paragraph's top 100px into the view, so its end sits far below the bottom edge.
		for (let pass = 0; pass < 3; pass++) {
			await page.evaluate((i) => {
				const view = document.querySelector('.editor') as HTMLElement;
				const block = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement;
				const top = view.getBoundingClientRect().top + view.clientTop;
				view.scrollTop += block.getBoundingClientRect().top - top - 100;
			}, TALL);
			await editor.waitForRenderFlush();
		}

		await editor.undo();
		await editor.bridge.waitForSourceContains('line after line, \n');
		await editor.waitForRenderFlush();

		const caret = await page.evaluate(() => {
			const view = document.querySelector('.editor') as HTMLElement;
			const top = view.getBoundingClientRect().top + view.clientTop;
			const range = window.getSelection()!.getRangeAt(0);
			const rects = range.getClientRects();
			const rect = rects.length ? rects[0] : range.getBoundingClientRect();
			return { top: rect.top - top, bottom: rect.bottom - top, band: view.clientHeight };
		});
		expect(caret.top).toBeGreaterThanOrEqual(-1);
		expect(caret.bottom).toBeLessThanOrEqual(caret.band + 1);
	});
});

test.describe('an undo step changes the document', () => {
	let editor: EditorPage;

	const canRun = (command: string) =>
		editor.page.evaluate((id) => (window as any).__test.canRunCommand(id) as boolean, command);

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing a character and deleting it is no step: one Ctrl+Z undoes the Enter before it', async () => {
		await editor.loadContent('ab\n');
		await editor.clickBlock(0);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.page.keyboard.press('ArrowLeft');
		await editor.page.keyboard.press('Enter');
		await editor.typeSlowly('a');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('a\n\nb\n');

		await editor.undo();
		await editor.bridge.waitForSourceEquals('ab\n');
		expect(await canRun('history.undo')).toBe(false);
	});

	test('the history commands read idle with nothing to undo or redo', async () => {
		await editor.loadContent('ab\n');
		expect(await canRun('history.undo'), 'a fresh document').toBe(false);
		expect(await canRun('history.redo'), 'a fresh document').toBe(false);

		await editor.clickBlock(0);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.typeSlowly('c');
		await editor.bridge.waitForSourceEquals('abc\n');
		expect(await canRun('history.undo'), 'after typing').toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceEquals('ab\n');
		expect(await canRun('history.undo'), 'after undoing it all').toBe(false);
		expect(await canRun('history.redo'), 'after undoing it all').toBe(true);
	});

	test('an undo whose caret leaves an empty heading keeps it, and redo gets back to the end', async () => {
		await editor.loadContent('#\n\nb\n');
		await editor.clickBlock(1);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.typeSlowly('c');
		await editor.endTypingBatch();
		await editor.clickBlock(0);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceEquals('#x\n\nbc\n');
		await editor.endTypingBatch();

		await editor.undo();
		await editor.bridge.waitForSourceEquals('#\n\nbc\n');
		await editor.undo();
		await editor.bridge.waitForSourceEquals('#\n\nb\n');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('#\n\nb\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		const focused = await editor.page.evaluate(() =>
			document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path')
		);
		expect(focused, 'the caret is back in the second block').toBe('[1]');

		await editor.redo();
		await editor.bridge.waitForSourceEquals('#\n\nbc\n');
		await editor.redo();
		await editor.bridge.waitForSourceEquals('#x\n\nbc\n');
	});

	// The redo's render moves the focused heading in the DOM, which blurs it before the caret lands.
	test('a redo that moves the focused empty heading keeps it a heading', async () => {
		const SOURCE = '#\n\nb\n\nc\n';
		await editor.loadContent(SOURCE);
		await editor.clickBlock(0);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.waitForNoSourceMutation();
		for (let i = 0; i < 3 && (await editor.bridge.getSource()) !== SOURCE; i++) {
			await editor.undo();
			await editor.waitForNoSourceMutation();
		}
		expect(await editor.bridge.getSource()).toBe(SOURCE);

		await editor.redo();
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('b\n\n#\n\nc\n');
	});
});
