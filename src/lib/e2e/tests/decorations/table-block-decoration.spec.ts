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

	test("a cell's class survives typing in the cell and an undo", async ({ page }) => {
		await addSource(page, 'e2e-cell-edit', { path: [0, 1, 0], class: 'e2e-cell-dec' });
		const cellC = page.locator(CELLS).nth(2);
		await expect(cellC).toHaveClass(/\be2e-cell-dec\b/);

		await cellC.click();
		await page.keyboard.press('End');
		await editor.typeText('x');
		await expect(cellC).toHaveText('cx');
		await expect(cellC).toHaveClass(/\be2e-cell-dec\b/);
		await editor.undo();
		await expect(cellC).toHaveText('c');
		await expect(cellC).toHaveClass(/\be2e-cell-dec\b/);
	});

	test('a decorated row outside the mounted window paints when it scrolls in', async ({ page }) => {
		const bodyRows = Array.from({ length: 200 }, (_, i) => `| row ${i} | data ${i} |\n`);
		await editor.loadContent('| a | b |\n| - | - |\n' + bodyRows.join(''));
		await editor.waitForRenderFlush();
		const deepRow = page.locator(ROWS).filter({ hasText: 'row 190' });
		// Without row windowing and an unmounted row 190, the paint below proves nothing.
		expect(await page.locator('.vr-spacer').count()).toBeGreaterThan(0);
		await expect(deepRow).toHaveCount(0);

		await addSource(page, 'e2e-deep-row', { path: [0, 191], class: 'e2e-row-dec' });
		await page.evaluate(() => {
			const scroller = document.querySelector('.editor') as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		await editor.waitForRenderFlush();

		await expect(deepRow).toHaveClass(/\be2e-row-dec\b/);
		await expect(page.locator(`${ROWS}.e2e-row-dec`)).toHaveCount(1);
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

		test('a class passed in attrs is refused and the row keeps its own', async ({ page }) => {
			const warnings: string[] = [];
			page.on('console', (m) => warnings.push(m.text()));
			await addSource(page, 'e2e-row-class', { path: [0, 1], attrs: { class: 'e2e-clobber' } });

			const bodyRow = page.locator(ROWS).nth(1);
			await expect.poll(() => warnings.some((w) => w.includes("'class' is reserved"))).toBe(true);
			await expect(bodyRow).toHaveClass(/\btable-row\b/);
			await expect(bodyRow).not.toHaveClass(/\be2e-clobber\b/);
			await page.evaluate(() => (window as any).__test.decorations.disposeSource('e2e-row-class'));
			await expect(bodyRow).toHaveClass(/\btable-row\b/);
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
