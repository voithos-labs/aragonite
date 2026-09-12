import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openFlyout } from './helpers';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

// Header + N distinguishable body rows; row k's first cell is `rk`. Tall enough that body rows
// window out, so once the editor is scrolled to the bottom row 0 is unmounted and a mounted
// row's local position no longer equals its CST index. Both roads must move the ABSOLUTE row.
// Requirements: requirements/blocks/table/reorder-windowed.md.
function tallTable(bodyRows: number): string {
	const lines = ['| key | val |', '| --- | --- |'];
	for (let i = 1; i <= bodyRows; i++) lines.push(`| r${i} | v${i} |`);
	return lines.join('\n') + '\n';
}

const BODY_ROWS = 300;

// An UNMOUNTED row's cells get no childIds until the row mounts, so the whole-CST walk reports
// `{tableRow, 2, 0}` for every off-window row; a move must add nothing else.
const benign = (m: { kind: string; children: number; ids: number }) =>
	m.kind === 'tableRow' && m.children === 2 && m.ids === 0;

test.describe('table block: row moves on a row-windowed table', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		// Fixed viewport so the mounted set is deterministic (matches the VR suites).
		await page.setViewportSize({ width: 1280, height: 720 });
		editor = new EditorPage(page);
		await editor.goto();
		test.setTimeout(60_000);

		await editor.loadContent(tallTable(BODY_ROWS));
		const scrollHeight = await page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).scrollHeight
		);
		await editor.scrollEditorTo(scrollHeight);

		// Load-bearing preconditions: the table windows, and row 0 is off-window at the decisive
		// instant, so a local index read here would be wrong by the unmounted head.
		expect(
			await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
		).toBeGreaterThan(0);
		await expect(page.locator('[data-table-row-idx="0"]')).toHaveCount(0);
	});

	test('Alt+ArrowDown on a deep row moves that row, and announces its absolute position', async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);
		const from = BODY_ROWS - 2;
		await page.locator(`[data-table-row-idx="${from}"] [role="cell"]`).first().click();

		await page.keyboard.press('Alt+ArrowDown');

		await editor.bridge.waitForSourceMatches(
			new RegExp(`\\| r${from + 1} \\|[^\\n]*\\n\\| r${from} \\|`)
		);
		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(
			`Moved row to position ${from + 1} of ${BODY_ROWS}`
		);
		expect((await getContainerParityMismatches(page)).filter((m) => !benign(m))).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	test('the Row flyout on a deep row moves that row up, keeping every row', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		const from = BODY_ROWS - 3;
		await openFlyout(
			page,
			page.locator(`[data-table-row-idx="${from}"] [role="cell"]`).first(),
			'Row'
		);

		await page.getByRole('menuitem', { name: 'Move row up' }).click();

		await editor.bridge.waitForSourceMatches(
			new RegExp(`\\| r${from} \\|[^\\n]*\\n\\| r${from - 1} \\|`)
		);
		// No row dropped or duplicated, and the table's row keys stayed in sync with its rows.
		const tableNode = await page.evaluate(() => {
			const t = (window as any).__test.getDocument().children[0];
			return { children: t.children.length, ids: t.childIds?.length ?? 0 };
		});
		expect(tableNode).toEqual({ children: BODY_ROWS + 1, ids: BODY_ROWS + 1 });
		expect((await getContainerParityMismatches(page)).filter((m) => !benign(m))).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});
