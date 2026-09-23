import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Block decorations addressed to a table row or cell
// (requirements/decorations/table-block-decoration.md).

const TABLE = "[data-block-path='[0]']";
const ROWS = `${TABLE} [role='row']`;
const CELLS = `${TABLE} :is([role='cell'], [role='columnheader'])`;

type BlockDecorationSpec = { path: number[]; class?: string; attrs?: Record<string, string> };

async function addSource(
	page: import('@playwright/test').Page,
	name: string,
	decoration: BlockDecorationSpec,
	withBadge = false
): Promise<void> {
	await page.evaluate(
		({ name, decoration, withBadge }) => {
			(window as any).__test.decorations.addSource({
				name,
				provide: () => [
					{
						type: 'block',
						...decoration,
						...(withBadge
							? {
									badge: {
										buildDom: () => {
											const el = document.createElement('span');
											el.className = 'e2e-table-badge';
											el.textContent = 'BADGE';
											return el;
										}
									}
								}
							: {})
					}
				]
			});
		},
		{ name, decoration, withBadge }
	);
}

test.describe('block decorations on table rows and cells', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('| a | b |\n| - | - |\n| c | d |\n');
	});

	test('class and attrs land on the addressed row and cell, and leave on dispose', async ({
		page
	}) => {
		await addSource(page, 'e2e-row', {
			path: [0, 1],
			class: 'e2e-row-dec',
			attrs: { 'data-e2e-row': 'on' }
		});
		await addSource(page, 'e2e-cell', {
			path: [0, 1, 1],
			class: 'e2e-cell-dec',
			attrs: { 'data-e2e-cell': 'on' }
		});

		const bodyRow = page.locator(ROWS).nth(1);
		await expect(bodyRow).toHaveClass(/\be2e-row-dec\b/);
		await expect(bodyRow).toHaveAttribute('data-e2e-row', 'on');
		await expect(page.locator(`${ROWS}.e2e-row-dec`)).toHaveCount(1);
		const cellD = page.locator(CELLS).nth(3);
		await expect(cellD).toHaveClass(/\be2e-cell-dec\b/);
		await expect(cellD).toHaveAttribute('data-e2e-cell', 'on');
		await expect(page.locator(`${CELLS}.e2e-cell-dec`)).toHaveCount(1);

		await page.evaluate(() => {
			(window as any).__test.decorations.disposeSource('e2e-row');
			(window as any).__test.decorations.disposeSource('e2e-cell');
		});
		await expect(page.locator(`${TABLE} .e2e-row-dec, ${TABLE} .e2e-cell-dec`)).toHaveCount(0);
		await expect(page.locator(`${TABLE} [data-e2e-row], ${TABLE} [data-e2e-cell]`)).toHaveCount(0);
	});

	test.describe('what a row or a cell cannot hold', () => {
		test.use({ expectWarns: ['decorations'] });

		test('a badge on a row is refused, its class still lands', async ({ page }) => {
			await addSource(page, 'e2e-row-badge', { path: [0, 1], class: 'e2e-row-dec' }, true);

			await expect(page.locator(ROWS).nth(1)).toHaveClass(/\be2e-row-dec\b/);
			await expect(page.locator(`${TABLE} .decoration-badge`)).toHaveCount(0);
		});

		test('a badge on a cell is refused, its class and text stay', async ({ page }) => {
			await addSource(page, 'e2e-cell-badge', { path: [0, 1, 0], class: 'e2e-cell-dec' }, true);

			const cellC = page.locator(CELLS).nth(2);
			await expect(cellC).toHaveClass(/\be2e-cell-dec\b/);
			await expect(page.locator(`${TABLE} .decoration-badge`)).toHaveCount(0);
			await expect(cellC).toHaveText('c');
		});

		test('an attribute the cell renders itself is refused and the cell stays editable', async ({
			page
		}) => {
			await addSource(page, 'e2e-cell-attr', {
				path: [0, 1, 0],
				attrs: { contenteditable: 'false', 'data-e2e-kept': '1' }
			});

			const cellC = page.locator(CELLS).nth(2);
			await expect(cellC).toHaveAttribute('data-e2e-kept', '1');
			await expect(cellC).toHaveAttribute('contenteditable', 'true');
			await page.evaluate(() => (window as any).__test.decorations.disposeSource('e2e-cell-attr'));
			await expect(cellC).not.toHaveAttribute('data-e2e-kept');
			await expect(cellC).toHaveAttribute('contenteditable', 'true');
		});
	});
});
