// A key that puts the caret somewhere off screen brings it into view, at the nearest edge.
import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

const DIVIDER_AT = 45;
// The block after the divider wraps to several lines, so moving the divider past it takes it
// wholly off the bottom of the screen.
const LINES = Array.from({ length: 90 }, (_, i) => {
	if (i === DIVIDER_AT) return '---';
	if (i === DIVIDER_AT + 1)
		return `Line ${i}, ${'long enough to wrap onto more lines, '.repeat(12)}`;
	return `Line ${i} with some words on it.`;
});

/** How far `path`'s block sits from the editor's visible bottom edge; positive when above it. */
const gapToBottom = (page: Page, index: number) =>
	page.evaluate((i) => {
		const view = document.querySelector('.editor') as HTMLElement;
		const block = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement;
		const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
		return bottom - block.getBoundingClientRect().bottom;
	}, index);

test.describe('a caret that ends up off screen comes into view', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(LINES.join('\n\n') + '\n');
		await editor.waitForRenderFlush();
		await page.evaluate((i) => (window as any).__test.rects.reveal([i]), DIVIDER_AT);
		await editor.waitForRenderFlush();
		// The caret first, so placing it scrolls nothing the test then measures.
		await editor.focusBlockEnd(DIVIDER_AT - 1);
	});

	/** Scrolls so the divider's top sits `below` pixels under the editor's bottom edge. Repeated,
	 *  since blocks measuring on the way down move the estimate the first scroll used. */
	async function putDividerTop(page: Page, below: number): Promise<void> {
		for (let pass = 0; pass < 3; pass++) {
			await page.evaluate(
				({ i, below }) => {
					const view = document.querySelector('.editor') as HTMLElement;
					const block = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement;
					const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
					view.scrollTop += block.getBoundingClientRect().top - bottom - below;
				},
				{ i: DIVIDER_AT, below }
			);
			await editor.waitForRenderFlush();
		}
	}

	async function arrowOntoDivider(page: Page): Promise<void> {
		await page.keyboard.press('ArrowDown');
		await expect
			.poll(() => editor.bridge.getSelectionPaths())
			.toMatchObject({
				focus: { path: [DIVIDER_AT] }
			});
		await editor.waitForRenderFlush();
	}

	test('ArrowDown onto a divider just below the viewport lands it at the bottom edge', async ({
		page
	}) => {
		await putDividerTop(page, 4);
		await expect(page.locator(`[data-block-path='[${DIVIDER_AT}]']`)).not.toBeInViewport();

		await arrowOntoDivider(page);

		expect(Math.abs(await gapToBottom(page, DIVIDER_AT))).toBeLessThanOrEqual(2);
	});

	test('Alt+ArrowDown moving a divider past the bottom edge brings it back to the edge', async ({
		page
	}) => {
		// On screen, just clear of the bottom edge, so the move takes it past it.
		const height = await page
			.locator(`[data-block-path='[${DIVIDER_AT}]']`)
			.evaluate((el) => el.getBoundingClientRect().height);
		await putDividerTop(page, -(height + 4));
		await arrowOntoDivider(page);

		await page.keyboard.press('Alt+ArrowDown');
		await expect.poll(() => editor.bridge.getBlockKind(DIVIDER_AT + 1)).toBe('thematicBreak');
		await editor.waitForRenderFlush();

		expect(Math.abs(await gapToBottom(page, DIVIDER_AT + 1))).toBeLessThanOrEqual(2);
	});

	test('Select All then ArrowRight in a long document brings the last block into view', async ({
		page
	}) => {
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await expect.poll(() => editor.bridge.isCrossBlockActive()).toBe(true);
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => editor.bridge.isCrossBlockActive()).toBe(false);
		await editor.waitForRenderFlush();

		await expect(page.locator(`[data-block-path='[${LINES.length - 1}]']`)).toBeInViewport();
	});
});

test.describe('a text or table caret that arrives off screen comes into view', () => {
	const PARA_AT = 45;
	const TABLE_AT = 60;
	const TABLE = [
		'| a | b |',
		'| --- | --- |',
		...Array.from({ length: 8 }, (_, r) => `| row ${r} | more |`)
	].join('\n');
	const DOC =
		Array.from({ length: 90 }, (_, i) =>
			i === TABLE_AT ? TABLE : `Line ${i} with some words on it.`
		).join('\n\n') + '\n';
	// On screen all but a sub-pixel sliver: the nearest edge lands a fraction of a pixel off.
	const WHOLE = 0.95;
	const table = (page: Page) => page.locator(`[data-block-path='[${TABLE_AT}]']`);
	const cellInRow = (page: Page, row: number) =>
		table(page).locator(`[data-table-row-idx='${row}'] .table-cell`).first();

	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
	});

	/** Scrolls so `selector`'s top sits a few pixels under the editor's bottom edge. Repeated,
	 *  since blocks measuring on the way down move the estimate the first scroll used. */
	async function putJustBelow(page: Page, selector: string): Promise<void> {
		for (let pass = 0; pass < 3; pass++) {
			await page.evaluate((sel) => {
				const view = document.querySelector('.editor') as HTMLElement;
				const el = document.querySelector(sel) as HTMLElement;
				const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
				view.scrollTop += el.getBoundingClientRect().top - bottom - 4;
			}, selector);
			await editor.waitForRenderFlush();
		}
		await expect(page.locator(selector).first()).not.toBeInViewport();
	}

	test('ArrowDown onto a paragraph just below the viewport brings it on screen', async ({
		page
	}) => {
		await page.evaluate((i) => (window as any).__test.rects.reveal([i]), PARA_AT);
		await editor.waitForRenderFlush();
		await editor.focusBlockEnd(PARA_AT - 1);
		await putJustBelow(page, `[data-block-path='[${PARA_AT}]']`);

		await page.keyboard.press('ArrowDown');
		await expect
			.poll(() => editor.bridge.getSelectionPaths())
			.toMatchObject({
				focus: { path: [PARA_AT] }
			});

		await expect(page.locator(`[data-block-path='[${PARA_AT}]']`)).toBeInViewport({ ratio: WHOLE });
	});

	test('ArrowDown onto a table just below the viewport brings its first cell on screen', async ({
		page
	}) => {
		await page.evaluate((i) => (window as any).__test.rects.reveal([i]), TABLE_AT);
		await editor.waitForRenderFlush();
		await editor.focusBlockEnd(TABLE_AT - 1);
		await putJustBelow(page, `[data-block-path='[${TABLE_AT}]']`);

		await page.keyboard.press('ArrowDown');
		await expect
			.poll(async () => (await editor.bridge.getSelectionPaths())?.focus.path[0])
			.toBe(TABLE_AT);

		// The cell the caret went to, whichever column the caret's x picked.
		await expect(table(page).locator(':focus')).toBeInViewport({ ratio: WHOLE });
	});

	test('ArrowDown from a table row to one just below the viewport brings its cell on screen', async ({
		page
	}) => {
		await page.evaluate((i) => (window as any).__test.rects.reveal([i]), TABLE_AT);
		await editor.waitForRenderFlush();
		await cellInRow(page, 3).click();
		await putJustBelow(page, `[data-block-path='[${TABLE_AT}]'] [data-table-row-idx='4']`);

		await page.keyboard.press('ArrowDown');
		await expect(cellInRow(page, 4)).toBeFocused();

		await expect(cellInRow(page, 4)).toBeInViewport({ ratio: WHOLE });
	});
});
