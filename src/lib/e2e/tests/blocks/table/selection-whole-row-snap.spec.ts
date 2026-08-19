import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { boxesOf, dragBetweenBoxes } from './helpers';

// head paragraph above a 3-col table with distinct body cells.
const FIXTURE =
	'head\n\n| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n';

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
		// Drag into a2 (row 1, col 1): the snap pulls the highlight to the whole row, so a3 — past
		// the drag endpoint — must be painted. Pre-snap the overlay stopped before the dragged
		// cell.
		const [head, a2] = await boxesOf(page.getByText('head'), page.locator('[role="cell"]').nth(4));
		await dragBetweenBoxes(page, head, a2);
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
