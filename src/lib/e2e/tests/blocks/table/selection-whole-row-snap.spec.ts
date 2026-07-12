import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// head paragraph above a 3-col table with distinct body cells.
const FIXTURE =
	'head\n\n| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n';

async function dragFromTextToCell(page: Page, text: string, cellIdx: number): Promise<void> {
	const from = page.getByText(text);
	const to = page.locator('[role="cell"]').nth(cellIdx);
	const fromBox = await from.boundingBox();
	const toBox = await to.boundingBox();
	if (!fromBox || !toBox) throw new Error('missing bounding box');
	const sx = fromBox.x + fromBox.width / 2;
	const sy = fromBox.y + fromBox.height / 2;
	const ex = toBox.x + toBox.width / 2;
	const ey = toBox.y + toBox.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	for (let i = 1; i <= 12; i++) {
		const t = i / 12;
		await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
	}
	await page.mouse.up();
}

function overlayCovers(
	rects: { x: number; y: number; width: number; height: number }[],
	target: { x: number; y: number; width: number; height: number }
): boolean {
	const cx = target.x + target.width / 2;
	const cy = target.y + target.height / 2;
	return rects.some((r) => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height);
}

test.describe('table block: cross-block whole-row selection snap', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(FIXTURE);
	});

	test('overlay covers the whole partially-selected row, including cells past the drag endpoint', async ({
		page
	}) => {
		// Drag into a2 (row 1, col 1). The snap pulls the highlight to the whole
		// row, so a3 (col 2 — past the drag endpoint) must be painted. Pre-snap the
		// overlay stopped before the dragged cell and a3 was never covered.
		await dragFromTextToCell(page, 'head', 4);
		await editor.waitForCrossBlock(true);

		const a3Box = await page.locator('[role="cell"]').nth(5).boundingBox();
		if (!a3Box) throw new Error('a3 cell not visible');

		const overlayBoxes = await page.locator('.selection-overlay').evaluateAll((els) =>
			els.map((el) => {
				const r = el.getBoundingClientRect();
				return { x: r.x, y: r.y, width: r.width, height: r.height };
			})
		);
		expect(overlayBoxes.length).toBeGreaterThan(0);
		expect(overlayCovers(overlayBoxes, a3Box)).toBe(true);
	});
});
