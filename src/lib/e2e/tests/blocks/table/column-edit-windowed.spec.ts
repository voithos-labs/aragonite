import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { clickInPlace } from '../../../click-in-place';
import { runColumnCommand } from '../../../table-columns';

// Column edits on a tall table whose top rows mounted once and then left the window: those rows
// hold ids with no mounted state, and each edit's cell splice must carry their ids along.
// Requirements: `requirements/blocks/table/column-edit-windowed.md`.

const BODY_ROWS = 300;
const TALL_TABLE = [
	'| key | val |',
	'| --- | --- |',
	...Array.from({ length: BODY_ROWS }, (_, i) => `| r${i + 1} | v${i + 1} |`)
].join('\n');

test.describe('table block: column edits on a row-windowed table', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		// Fixed viewport so the mounted set is deterministic (matches the VR suites).
		await page.setViewportSize({ width: 1280, height: 720 });
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TALL_TABLE);
		const scrollHeight = await page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).scrollHeight
		);
		await editor.scrollEditorTo(scrollHeight);
		await expect(page.locator('[data-table-row-idx="0"]')).toHaveCount(0);
	});

	test('a column delete then a column insert keep every row’s ids in step, and undo restores', async ({
		page
	}) => {
		const deep = BODY_ROWS - 2;
		await clickInPlace(page.locator(`[data-table-row-idx="${deep}"] .table-cell`).first());
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceMatches(/^\| val \|\n/);
		expect(await getContainerParityMismatches(page)).toEqual([]);

		await runColumnCommand(page, 'Insert column right');
		await editor.bridge.waitForSourceMatches(/^\| val \| {2}\|\n/);
		expect(await getContainerParityMismatches(page)).toEqual([]);

		await editor.undo();
		await editor.undo();
		await editor.bridge.waitForSourceEquals(TALL_TABLE);
		expect(await getContainerParityMismatches(page)).toEqual([]);
	});
});
