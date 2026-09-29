import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { capturePageErrors } from '../../page-probes';
import { spacerCount } from './vr-helpers';

// A table row that changes height without its bytes changing is measured again, so the table's
// height table holds the row as drawn. Opening a tall formula's source in a cell is the gesture.
// Requirements: e2e/requirements/perf/vr-table-row-remeasure.md.

const TABLE_INDEX = 1;
const TALL_MATH = String.raw`$\begin{matrix}a \\ b \\ c \\ d\end{matrix}$`;
const DOC = [
	'Intro paragraph.',
	[
		'| # | Notes |',
		'| --- | --- |',
		...Array.from({ length: 220 }, (_, i) => `| ${i} | row ${i} ${TALL_MATH} |`)
	].join('\n'),
	...Array.from({ length: 40 }, (_, i) => `Tail paragraph ${i}.`)
].join('\n\n');
const ROW = 2;

/** The row's entry in the table's height table beside its first cell's drawn height. */
function rowReading(page: Page, row: number): Promise<{ measured: number; drawn: number }> {
	return page.evaluate(
		({ index, row }) => {
			const cell = document.querySelector(
				`[data-table-row-idx='${row}'] > .table-cell`
			) as HTMLElement;
			return {
				measured: (window as any).__test.tableHeightAt([index, row]),
				drawn: cell.getBoundingClientRect().height
			};
		},
		{ index: TABLE_INDEX, row }
	);
}

test('a row that shrinks as its formula shows its source is measured again', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new PluginsPage(page);
	await editor.gotoPlugins();
	await editor.loadContent(DOC);
	await editor.waitForResizeObserverFlush();
	expect(await spacerCount(page, '.table-block >'), 'the table must window').toBeGreaterThan(0);
	const rendered = await rowReading(page, ROW);
	expect(rendered.measured).toBeCloseTo(rendered.drawn, 0);

	await page.locator(`[data-table-row-idx='${ROW}'] .math-inline-widget`).click();
	await editor.waitForRenderFlush();
	await editor.waitForResizeObserverFlush();

	const revealed = await rowReading(page, ROW);
	// Only a row whose height really moved says anything about measuring it again.
	expect(revealed.drawn).toBeLessThan(rendered.drawn - 20);
	expect(Math.abs(revealed.measured - revealed.drawn)).toBeLessThanOrEqual(1);
	expect(pageErrors).toEqual([]);
});
