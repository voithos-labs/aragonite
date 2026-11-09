import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import {
	PluginsPage,
	readCallout,
	activeBlockPath,
	capturedErrors,
	dragBetweenPoints,
	stateConsistencyViolations
} from './reserved-chrome-helpers';
import { pointAtRaw } from '../../text-runs';

/**
 * The `:::callout` callout holds its opener line as child 0, an editable title row (see
 * src/routes/test/plugins/callout). Part 6, that boundary inside a table: `involvesTable` is
 * checked before `involvesReservedChrome`, so a range with a table endpoint takes the table path,
 * and the boundary must hold there too: a covered title is emptied, a title at an endpoint
 * truncates in place, and a fully covered container is deleted whole.
 */
test.describe('reserved child-0 chrome: wall × table branch', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	// ── Part 6: the same boundary inside a table ────────────────────────

	// Table in the callout body: [0]=para "Above", [1]=callout ([1,0]=title,
	// [1,1]=table of header row (a,b) + body row (1,2)), [2]=para "Below".
	const TBL_FIXTURE =
		'Above\n\n:::callout Title\n| a | b |\n| --- | --- |\n| 1 | 2 |\n:::\n\nBelow\n';
	// A table above the callout: [0]=table, [1]=callout ([1,0]=title, [1,1]=para "Body").
	const TBL_ABOVE_FIXTURE =
		'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::callout Title\nBody\n:::\n\nBelow\n';
	// Tables on both sides of the boundary: [0]=table, [1]=callout ([1,0]=title, [1,1]=table).
	const TBL_BOTH_FIXTURE =
		'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::callout Title\n| c | d |\n| --- | --- |\n| 3 | 4 |\n:::\n\nBelow\n';

	async function cellCenter(page: Page, nth: number): Promise<{ x: number; y: number }> {
		const box = await page.locator('.table-cell').nth(nth).boundingBox();
		if (!box) throw new Error(`Gate 6: cell ${nth} has no bounding box`);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}

	test('Gate 6a: prose above → into the header cell; the table goes whole, the opening stays', async ({
		page
	}) => {
		await editor.loadContent(TBL_FIXTURE);
		// Dropping in header cell "a" enters the table by its first row, which takes it whole, while the
		// opening the range enters stays whole; removing it would leave the closer alone.
		await editor.dragFromTo([0], 2, [1, 1], 0);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout Title\n:::');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['directiveOpenerLine']);
		expect(callout.childTexts[0]).toBe(':::callout Title');
		// The truncated start of the prose keeps its line ending, so the blank line the source had
		// between it and the container survives.
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout Title\n:::\n\nBelow\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// The emptying went through a copy made before the write (G1.9), so undo restores the title
		// node itself; polling the CST children, not the bytes, waits for the rebuild.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['directiveOpenerLine', 'table']);
		expect((await readCallout(page, 1)).childTexts).toEqual([
			':::callout Title',
			'| a | b |\n| --- | --- |\n| 1 | 2 |'
		]);
		expect(await editor.bridge.getSource()).toBe(TBL_FIXTURE);
	});

	test('Gate 6b: mid-title → the header cell; the title truncates in place, the table goes whole', async ({
		page
	}) => {
		await editor.loadContent(TBL_FIXTURE);
		// Starting in the title of the same container: the boundary truncates by writing raw, so the
		// title keeps its kind rather than reparsing as a paragraph.
		await editor.dragFromTo([1, 0], 14, [1, 1], 0);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout Tit\n');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['directiveOpenerLine']);
		expect(callout.childTexts[0]).toBe(':::callout Tit');
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::callout Tit\n:::\n\nBelow\n');
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['directiveOpenerLine', 'table']);
		expect((await readCallout(page, 1)).childTexts[0]).toBe(':::callout Title');
		expect(await editor.bridge.getSource()).toBe(TBL_FIXTURE);
	});

	test('Gate 6c: table above → mid-title; the title keeps its tail in place, no reparse-replacement', async ({
		page
	}) => {
		await editor.loadContent(TBL_ABOVE_FIXTURE);
		// Anchor in body cell "1", the table's last row: the range takes the whole table, and the end in
		// the title must keep "le" in the title row.
		await dragBetweenPoints(
			page,
			await cellCenter(page, 2),
			await pointAtRaw(editor.page, [1, 0], 14)
		);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout le');

		const callout = await readCallout(page, 0);
		expect(callout.childKinds).toEqual(['directiveOpenerLine', 'paragraph']);
		expect(callout.childTexts).toEqual([':::callout le', 'Body']);
		expect(await editor.bridge.getSource()).toBe(':::callout le\nBody\n:::\n\nBelow\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 6d: table → table across the wall; both tables go whole, the opening stays', async ({
		page
	}) => {
		await editor.loadContent(TBL_BOTH_FIXTURE);
		// Outer body cell "1" (its last row) to inner header cell "c" (its first): each table goes whole,
		// and the opening between them stays.
		await dragBetweenPoints(page, await cellCenter(page, 2), await cellCenter(page, 4));
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceEquals(':::callout Title\n:::\n\nBelow\n');

		const callout = await readCallout(page, 0);
		expect(callout.childKinds).toEqual(['directiveOpenerLine']);
		expect(callout.childTexts[0]).toBe(':::callout Title');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childTexts[0]))
			.toBe(':::callout Title');
		expect(await editor.bridge.getSource()).toBe(TBL_BOTH_FIXTURE);
	});

	test("Gate 6e: a table-involving range consuming the container's whole subtree unit-deletes it", async ({
		page
	}) => {
		await editor.loadContent(TBL_ABOVE_FIXTURE);
		// The whole subtree is covered from outside, so the container goes as one, never leaving an
		// empty leftover with the title removed.
		await dragBetweenPoints(
			page,
			await cellCenter(page, 2),
			await pointAtRaw(editor.page, [1, 1], 4)
		);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains(':::callout');

		// The range starts in the table's last row, which takes the table whole too.
		expect(await editor.bridge.getSource()).toBe('Below\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// That single-splice delete undoes to the full container, children intact.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['directiveOpenerLine', 'paragraph']);
		expect((await readCallout(page, 1)).childTexts).toEqual([':::callout Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe(TBL_ABOVE_FIXTURE);
	});
});
