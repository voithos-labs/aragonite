// A key that puts the caret somewhere off screen brings it into view, at the nearest edge.
import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { gotoReady } from '../../goto-ready';
import { FENCE, LAST_CELL, TABLE as GAP_TABLE, filler } from '../selection/gap-caret-fixtures';
import { clickInPlace } from '../../click-in-place';

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

/** The caret's line box against the editor's visible band, in viewport pixels. */
const caretAndBand = (page: Page) =>
	page.evaluate(() => {
		const view = document.querySelector('.editor') as HTMLElement;
		const top = view.getBoundingClientRect().top + view.clientTop;
		const range = window.getSelection()!.getRangeAt(0);
		const rects = range.getClientRects();
		const caret = rects.length ? rects[0] : range.getBoundingClientRect();
		return { top: caret.top - top, bottom: caret.bottom - top, band: view.clientHeight };
	});

async function expectCaretShown(page: Page, label: string): Promise<void> {
	const at = await caretAndBand(page);
	expect(at.top, label).toBeGreaterThanOrEqual(-1);
	expect(at.bottom, label).toBeLessThanOrEqual(at.band + 1);
}

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
		await expect.poll(() => editor.bridge.ownsRange()).toBe(true);
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => editor.bridge.ownsRange()).toBe(false);
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

	test('ArrowDown onto a paragraph just below the viewport brings its caret on screen', async ({
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

		await expectCaretShown(page, 'after ArrowDown');
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
		await clickInPlace(cellInRow(page, 3));
		await putJustBelow(page, `[data-block-path='[${TABLE_AT}]'] [data-table-row-idx='4']`);

		await page.keyboard.press('ArrowDown');
		await expect(cellInRow(page, 4)).toBeFocused();

		await expect(cellInRow(page, 4)).toBeInViewport({ ratio: WHOLE });
	});
});

test.describe('an arrival shows the caret itself, however it lands', () => {
	const TABLE_AT = 5;
	const ROWS = 40;
	const PARA_AT = 50;
	const TALL_AT = 70;
	const TABLE = [
		'| a | b |',
		'| --- | --- |',
		...Array.from({ length: ROWS }, (_, r) => `| row ${r} | more |`)
	].join('\n');
	const DOC =
		Array.from({ length: 100 }, (_, i) => {
			if (i === TABLE_AT) return TABLE;
			if (i === TALL_AT) return `Tall ${'paragraph that wraps onto line after line, '.repeat(160)}`;
			return `Line ${i} with some words on it.`;
		}).join('\n\n') + '\n';

	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
	});

	const scrollTopOf = (page: Page) =>
		page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);

	// Miss-analysis: the in-view check counted a sub-pixel sliver of a cell as on screen, and the
	// one table row test stepped a single row, so every other press of a long walk went unseen.
	test('walking down a long table keeps every row’s caret on screen', async ({ page }) => {
		const table = page.locator(`[data-block-path='[${TABLE_AT}]']`);
		await clickInPlace(table.locator("[data-table-row-idx='0'] .table-cell").first());
		for (let row = 1; row < ROWS; row++) {
			await page.keyboard.press('ArrowDown');
			await expect(
				table.locator(`[data-table-row-idx='${row}'] .table-cell`).first()
			).toBeFocused();
			await editor.waitForRenderFlush();
			await expectCaretShown(page, `row ${row}`);
		}
	});

	// The line's own box peeks, not the block's padding under it: an overlap check would call that
	// line shown, so only the whole-line rule scrolls here.
	test('ArrowUp onto a paragraph whose last line peeks 2px from the top shows that line', async ({
		page
	}) => {
		await page.evaluate((i) => (window as any).__test.rects.reveal([i]), PARA_AT);
		await editor.waitForRenderFlush();
		await editor.focusBlockStart(PARA_AT + 1);
		for (let pass = 0; pass < 3; pass++) {
			await page.evaluate((i) => {
				const view = document.querySelector('.editor') as HTMLElement;
				const text = document.querySelector(
					`[data-block-path='[${i}]'] [contenteditable="true"]`
				) as HTMLElement;
				const range = document.createRange();
				range.selectNodeContents(text);
				const lines = range.getClientRects();
				const lastLine = lines[lines.length - 1];
				const top = view.getBoundingClientRect().top + view.clientTop;
				view.scrollTop += lastLine.bottom - top - 2;
			}, PARA_AT);
			await editor.waitForRenderFlush();
		}

		await page.keyboard.press('ArrowUp');
		await expect
			.poll(async () => (await editor.bridge.getSelectionPaths())?.focus.path)
			.toEqual([PARA_AT]);
		await editor.waitForRenderFlush();

		await expectCaretShown(page, 'after ArrowUp');
	});

	// Miss-analysis: every arrival test landed on a block shorter than the viewport, where showing
	// the block and showing the caret's line are the same scroll.
	test('ArrowDown onto a paragraph taller than the viewport moves the page by about a line', async ({
		page
	}) => {
		await page.evaluate((i) => (window as any).__test.rects.reveal([i]), TALL_AT);
		await editor.waitForRenderFlush();
		await editor.focusBlockEnd(TALL_AT - 1);
		for (let pass = 0; pass < 3; pass++) {
			await page.evaluate((i) => {
				const view = document.querySelector('.editor') as HTMLElement;
				const block = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement;
				const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
				view.scrollTop += block.getBoundingClientRect().top - bottom - 4;
			}, TALL_AT);
			await editor.waitForRenderFlush();
		}
		const tall = await page
			.locator(`[data-block-path='[${TALL_AT}]']`)
			.evaluate((el) => el.getBoundingClientRect().height);
		const band = await page.locator('.editor').evaluate((el) => el.clientHeight);
		expect(tall).toBeGreaterThan(band);
		const before = await scrollTopOf(page);

		await page.keyboard.press('ArrowDown');
		await expect
			.poll(async () => (await editor.bridge.getSelectionPaths())?.focus.path)
			.toEqual([TALL_AT]);
		await editor.waitForRenderFlush();

		await expectCaretShown(page, 'after ArrowDown');
		expect(Math.abs((await scrollTopOf(page)) - before)).toBeLessThan(80);
	});
});

test.describe('a gap caret that arrives off screen comes into view at the nearest edge', () => {
	const TABLE_AT = 30;
	const GAP = { parentPath: [], index: TABLE_AT + 1 };

	/** The gap's boundary against the editor's visible band, in viewport pixels. */
	const gapInBand = (page: Page) =>
		page.evaluate(() => {
			const view = document.querySelector('.editor') as HTMLElement;
			const top = view.getBoundingClientRect().top + view.clientTop;
			const gap = document.querySelector('[data-gap-caret]') as HTMLElement;
			return { at: gap.getBoundingClientRect().top - top, band: view.clientHeight };
		});

	// Miss-analysis: every gap test had the gap on screen or ran where the browser's own focus
	// scroll happened to show it, so nothing noticed no route asked the editor to show the gap.
	for (const below of [4, 40]) {
		test(`ArrowDown onto a gap ${below}px under the bottom edge lands it at that edge`, async ({
			page
		}) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(`${filler(30, 0)}\n${GAP_TABLE}\n${FENCE}\n${filler(80, 30)}`);
			await page.evaluate((i) => (window as any).__test.rects.reveal([i]), TABLE_AT);
			await editor.waitForRenderFlush();
			await clickInPlace(page.locator('.table-cell').nth(LAST_CELL));
			// The table's bottom, where the gap opens, `below` pixels under the editor's bottom edge.
			for (let pass = 0; pass < 3; pass++) {
				await page.evaluate(
					({ i, below }) => {
						const view = document.querySelector('.editor') as HTMLElement;
						const block = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement;
						const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
						view.scrollTop += block.getBoundingClientRect().bottom - bottom - below;
					},
					{ i: TABLE_AT, below }
				);
				await editor.waitForRenderFlush();
			}

			await page.keyboard.press('ArrowDown');
			await editor.bridge.waitForGapCaret(GAP);
			await editor.waitForRenderFlush();

			const { at, band } = await gapInBand(page);
			expect(at).toBeLessThan(band);
			// At the edge, not centred: the gap sits within its own line of the bottom.
			expect(at).toBeGreaterThan(band - 30);
		});
	}
});

test.describe('a block that shows its source on arrival comes into view', () => {
	const MATH_AT = 30;
	const lines = (count: number, from: number) =>
		Array.from({ length: count }, (_, i) => `Line ${from + i} with some words on it.`);

	// Miss-analysis: the source opens a tick after the move hands the block the caret, and every
	// math arrival test started on screen, where nothing had to scroll.
	test('ArrowDown onto a block formula just below the viewport shows its source', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await gotoReady(page, '/test/plugins?seed=mathblock');
		await editor.loadContent(
			[...lines(MATH_AT, 0), '$$x^2$$', ...lines(30, MATH_AT + 1)].join('\n\n') + '\n'
		);
		await editor.waitForRenderFlush();
		await editor.focusBlockEnd(MATH_AT - 1);
		for (let pass = 0; pass < 3; pass++) {
			await page.evaluate((i) => {
				const view = document.querySelector('.editor') as HTMLElement;
				const block = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement;
				const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
				view.scrollTop += block.getBoundingClientRect().top - bottom - 4;
			}, MATH_AT);
			await editor.waitForRenderFlush();
		}
		await expect(page.locator(`[data-block-path='[${MATH_AT}]']`)).not.toBeInViewport();

		await page.keyboard.press('ArrowDown');
		await expect(page.locator('.math-block-source')).toHaveCount(1);
		await editor.waitForRenderFlush();

		await expectCaretShown(page, 'after ArrowDown');
	});
});
