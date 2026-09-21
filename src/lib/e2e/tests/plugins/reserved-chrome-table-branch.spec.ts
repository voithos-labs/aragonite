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

/**
 * The `:::callout` callout reserves child 0 as an editable `callout-title` row (see
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
		const box = await page.locator('[role="cell"]').nth(nth).boundingBox();
		if (!box) throw new Error(`Gate 6: cell ${nth} has no bounding box`);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}

	test('Gate 6 substrate: a table parses as a real callout body child', async ({ page }) => {
		await editor.loadContent(TBL_FIXTURE);
		const callout = await readCallout(page, 1);
		expect(callout.kind).toBe('callout');
		expect(callout.childKinds).toEqual(['callout-title', 'table']);
		expect(callout.childTexts[0]).toBe('Title');
		expect(await editor.bridge.getSource()).toBe(TBL_FIXTURE);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 6a: prose above → into a body table cell; the title clears, never node-deletes', async ({
		page
	}) => {
		await editor.loadContent(TBL_FIXTURE);
		// Drop in header cell "a": snapping to whole rows covers row 0, so the table behaves as
		// the table path says, with the header removed and "1|2" promoted, while the title in
		// between must be emptied in place. Removing that node lets the rebuild move the table up
		// into the opener line.
		await editor.dragFromTo([0], 2, [1, 1], 0);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout\n');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'table']);
		expect(callout.childTexts[0]).toBe('');
		expect(callout.raw).toBe(':::callout\n| 1 | 2 |\n| --- | --- |\n:::\n');
		// The truncated start of the prose keeps its line ending, so the blank line the source had
		// between it and the container survives, matching the case below that starts in the title.
		expect(await editor.bridge.getSource()).toBe(
			'Ab\n\n:::callout\n| 1 | 2 |\n| --- | --- |\n:::\n\nBelow\n'
		);
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// Undo at the child level: the emptying went through a copy made before the write (G1.9),
		// so the title node itself is restored, where getSource alone cannot see a corrupted
		// child. Poll the children in the CST, not the bytes, so the reads below wait for the
		// tree to rebuild.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['callout-title', 'table']);
		expect((await readCallout(page, 1)).childTexts).toEqual([
			'Title',
			'| a | b |\n| --- | --- |\n| 1 | 2 |'
		]);
		expect(await editor.bridge.getSource()).toBe(TBL_FIXTURE);
	});

	test('Gate 6b: mid-title → body table cell; the title truncates in place, kind kept', async ({
		page
	}) => {
		await editor.loadContent(TBL_FIXTURE);
		// Starting in the title of the same container: reparsing the endpoint used to replace the
		// title with a paragraph, losing its kind, where the boundary truncates by writing raw.
		await editor.dragFromTo([1, 0], 3, [1, 1], 0);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout Tit\n');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'table']);
		expect(callout.childTexts[0]).toBe('Tit');
		expect(await editor.bridge.getSource()).toBe(
			'Above\n\n:::callout Tit\n| 1 | 2 |\n| --- | --- |\n:::\n\nBelow\n'
		);
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['callout-title', 'table']);
		expect((await readCallout(page, 1)).childTexts[0]).toBe('Title');
		expect(await editor.bridge.getSource()).toBe(TBL_FIXTURE);
	});

	test('Gate 6c: table above → mid-title; the title keeps its tail in place, no reparse-replacement', async ({
		page
	}) => {
		await editor.loadContent(TBL_ABOVE_FIXTURE);
		// Anchor in body cell "1", row 1: snapping to whole rows removes that row and the header
		// survives, and the end in the title must keep "le" in the title row.
		await dragBetweenPoints(
			page,
			await cellCenter(page, 2),
			await editor.pointForOffset([1, 0], 3)
		);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout le');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['le', 'Body']);
		expect(await editor.bridge.getSource()).toBe(
			'| a | b |\n| --- | --- |\n\n:::callout le\nBody\n:::\n\nBelow\n'
		);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 6d: table → table across the wall; the between chrome clears, never deletes', async ({
		page
	}) => {
		await editor.loadContent(TBL_BOTH_FIXTURE);
		// Outer body cell "1" to inner header cell "c": both endpoints are in tables and the title
		// sits between them, which covers the shared helper.
		await dragBetweenPoints(page, await cellCenter(page, 2), await cellCenter(page, 4));
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout\n');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'table']);
		expect(callout.childTexts[0]).toBe('');
		expect(await editor.bridge.getSource()).toBe(
			'| a | b |\n| --- | --- |\n\n:::callout\n| 3 | 4 |\n| --- | --- |\n:::\n\nBelow\n'
		);
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect.poll(() => readCallout(page, 1).then((n) => n.childTexts[0])).toBe('Title');
		expect(await editor.bridge.getSource()).toBe(TBL_BOTH_FIXTURE);
	});

	test("Gate 6e: a table-involving range consuming the container's whole subtree unit-deletes it", async ({
		page
	}) => {
		await editor.loadContent(TBL_ABOVE_FIXTURE);
		// Body cell "1" to the container's last byte, the end of "Body": the whole subtree is
		// covered from outside, so the container goes as one, never leaving an empty leftover
		// with the title removed.
		await dragBetweenPoints(
			page,
			await cellCenter(page, 2),
			await editor.pointForOffset([1, 1], 4)
		);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains(':::callout');

		expect(await editor.bridge.getSource()).toBe('| a | b |\n| --- | --- |\n\nBelow\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// That single-splice delete undoes to the full container, children intact.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['callout-title', 'paragraph']);
		expect((await readCallout(page, 1)).childTexts).toEqual(['Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe(TBL_ABOVE_FIXTURE);
	});
});
