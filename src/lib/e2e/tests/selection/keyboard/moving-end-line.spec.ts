import { test, expect } from '../../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../../editor-page';
import { clickWordSettled, enterPresentationMode, landAt } from '../../presentation/helpers';

// Over a selection, Shift+ArrowUp and Shift+ArrowDown ask which line the selection's moving end
// is on, not its start. Requirements: `e2e/requirements/selection/keyboard/moving-end-line.md`.

// Each block's text is `abc def\` + newline + `e.g.`, 13 long, with line two from 9.
const PARAGRAPH = 'before\n\nabc def\\\ne.g.\n\nafter\n';
const LIST_ITEM = '- abc def\\\n  e.g.\n\nafter\n';
// The cell's text is `Left<br>Right`, 13 long, with `Right` on line two from 8.
const CELL = 'top\n\n| H |\n| - |\n| Left<br>Right |\n\nafter\n';
const TEXT_END = 13;
const CELL_LINE_TWO = 8;

const selection = async (ep: EditorPage) => (await ep.bridge.getSelectionPaths())!;

async function shiftPress(ep: EditorPage, page: Page, key: string): Promise<void> {
	await page.keyboard.press(`Shift+${key}`);
	await ep.waitForRenderFlush();
}

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode}: the selection's moving end decides its line`, () => {
		for (const [name, doc, blockIndex] of [
			['paragraph', PARAGRAPH, 1],
			['list item', LIST_ITEM, 0]
		] as const) {
			test(`${name}: from line one to the end, Shift+ArrowDown extends into the next block`, async ({
				page
			}) => {
				const ep = await enterPresentationMode(page, mode, doc);
				await clickWordSettled(ep, page, 'def');
				await landAt(ep, page, 5);
				await shiftPress(ep, page, 'ArrowDown');
				expect((await selection(ep)).focus.offset).toBe(TEXT_END);

				await shiftPress(ep, page, 'ArrowDown');
				await ep.waitForCrossBlock(true);
				const sel = await selection(ep);
				expect(sel.anchor.offset).toBe(5);
				expect(sel.focus.path).toEqual([blockIndex + 1]);
			});
		}

		test('table cell: from line one to line two, Shift+ArrowUp moves back up inside the cell', async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, mode, CELL);
			await clickWordSettled(ep, page, 'Left');
			await landAt(ep, page, 1);
			await shiftPress(ep, page, 'ArrowDown');
			expect((await selection(ep)).focus.offset).toBeGreaterThan(CELL_LINE_TWO);

			await shiftPress(ep, page, 'ArrowUp');
			expect(await ep.bridge.isCrossBlockActive()).toBe(false);
			const sel = await selection(ep);
			expect(sel.focus.path).toEqual(sel.anchor.path);
			expect(sel.focus.offset).toBeLessThan(CELL_LINE_TWO);
		});

		test("table cell: from line one to the cell's end, Shift+ArrowDown extends out of the table", async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, mode, CELL);
			await clickWordSettled(ep, page, 'Left');
			await landAt(ep, page, 1);
			await shiftPress(ep, page, 'ArrowDown');
			await shiftPress(ep, page, 'End');
			expect((await selection(ep)).focus.offset).toBe(TEXT_END);

			await shiftPress(ep, page, 'ArrowDown');
			await ep.waitForCrossBlock(true);
			expect((await selection(ep)).focus.path).toEqual([2]);
		});
	});
}
