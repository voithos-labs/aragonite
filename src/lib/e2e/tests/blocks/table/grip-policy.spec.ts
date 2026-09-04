import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The grips are pointer chrome, so `blockDragHandles=false` must leave nothing behind, not
// hide it: a hidden grip still occupies its gutter track. Requirements: requirements/blocks/table/grip-policy.md.
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

test.describe('table block: the grips follow blockDragHandles', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
	});

	test('handles on: hovering the table shows a grip per column and per row', async ({ page }) => {
		await editor.goto();
		await editor.loadContent(TABLE);
		await page.hover('[role="table"]');

		await expect(page.locator('[data-table-col-grip]')).toHaveCount(2);
		await expect(page.locator('[data-table-row-grip]')).toHaveCount(2);
	});

	test('blockDragHandles=false renders no grip, even on hover', async ({ page }) => {
		await editor.goto('?dragHandles=false');
		await editor.loadContent(TABLE);
		await page.hover('[role="table"]');

		await expect(page.locator('[data-table-col-grip]')).toHaveCount(0);
		await expect(page.locator('[data-table-row-grip]')).toHaveCount(0);
	});

	test('reading mode renders no grip whatever the flag says', async ({ page }) => {
		await editor.goto('?presentationMode=reading');
		await editor.loadContent(TABLE);
		await page.hover('[role="table"]');

		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await expect(page.locator('[data-table-col-grip]')).toHaveCount(0);
		await expect(page.locator('[data-table-row-grip]')).toHaveCount(0);
	});

	test.describe('under touch, where nothing hovers', () => {
		test.use({ hasTouch: true });

		test('the grips show unasked and a tap opens the row menu', async ({ page }) => {
			await editor.goto();
			await editor.loadContent(TABLE);

			const grip = page.locator('[data-table-row-grip]').first();
			// Nothing can hover the table, so a grip still keyed on hover stays transparent.
			await expect.poll(() => grip.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

			// The menu is the proof the tap reached the grip rather than the cell behind it.
			await grip.tap();
			await expect(page.getByRole('menuitem', { name: /insert row below/i })).toBeVisible();
		});
	});

	// The row grip lives in a leading zero-width grid track and the rows auto-place, so dropping
	// the grip without dropping the track puts cell A in a 0px column and wraps the last cell.
	test('grips off leaves the cell grid on the same tracks', async ({ page }) => {
		await editor.goto();
		await editor.loadContent(TABLE);
		const gripped = await page.locator('[role="cell"]').first().boundingBox();

		await editor.goto('?dragHandles=false');
		await editor.loadContent(TABLE);
		const bare = await page.locator('[role="cell"]').first().boundingBox();

		expect(bare!.x).toBeCloseTo(gripped!.x, 1);
		expect(bare!.width).toBeCloseTo(gripped!.width, 1);
	});
});
