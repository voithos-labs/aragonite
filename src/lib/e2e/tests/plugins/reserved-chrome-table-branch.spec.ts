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
 * The `:::callout` callout reserves child 0 as an editable `callout-title` chrome leaf (see
 * src/routes/test/plugins/callout). Gate 6 — the chrome wall × the table branch: `involvesTable`
 * dispatches before `involvesReservedChrome`, so a range with a table endpoint takes the table
 * branch, and the wall must hold there too — covered chrome clears, chrome endpoints truncate in
 * place, and a consumed container unit-deletes.
 */
test.describe('reserved child-0 chrome: wall × table branch', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	// ── Gate 6 — chrome wall × table branch ─────────────────────────────

	// Table in the callout body: [0]=para "Above", [1]=callout ([1,0]=title,
	// [1,1]=table of header row (a,b) + body row (1,2)), [2]=para "Below".
	const TBL_FIXTURE =
		'Above\n\n:::callout Title\n| a | b |\n| --- | --- |\n| 1 | 2 |\n:::\n\nBelow\n';
	// Table ABOVE the callout: [0]=table, [1]=callout ([1,0]=title, [1,1]=para "Body").
	const TBL_ABOVE_FIXTURE =
		'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::callout Title\nBody\n:::\n\nBelow\n';
	// Tables on both sides of the wall: [0]=table, [1]=callout ([1,0]=title, [1,1]=table).
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

	test('Gate 6a: prose above → into a body table cell — the title clears, never node-deletes', async ({
		page
	}) => {
		await editor.loadContent(TBL_FIXTURE);
		// Drop in header cell "a": the whole-row snap covers row 0, so the table takes its
		// table-branch semantics (header removed, "1|2" promoted) while the strictly-between title
		// must CLEAR in place: node-deleting it lets the rebuild hoist the table into the opener.
		await editor.dragFromTo([0], 2, [1, 1], 0);
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout\n');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'table']);
		expect(callout.childTexts[0]).toBe('');
		expect(callout.raw).toBe(':::callout\n| 1 | 2 |\n| --- | --- |\n:::\n');
		// The truncated prose head keeps its line ending, so the blank line the source had between
		// it and the container survives — matching the chrome-start case below, whose arm always
		// terminated its head.
		expect(await editor.bridge.getSource()).toBe(
			'Ab\n\n:::callout\n| 1 | 2 |\n| --- | --- |\n:::\n\nBelow\n'
		);
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// Child-level undo: the clear went through an unshared copy (G1.9), so the title node
		// itself is restored — getSource alone is blind to a corrupted child. Poll the CST children
		// (not the source bytes) so the reads below wait for the tree to re-materialize.
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

	test('Gate 6b: mid-title → body table cell — the title truncates in place, kind kept', async ({
		page
	}) => {
		await editor.loadContent(TBL_FIXTURE);
		// Same-container chrome start: the endpoint-reparse hole replaced the title
		// with a reparsed paragraph (kind destroyed); the wall truncates by raw write.
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

	test('Gate 6c: table above → mid-title — the title keeps its tail in place, no reparse-replacement', async ({
		page
	}) => {
		await editor.loadContent(TBL_ABOVE_FIXTURE);
		// Anchor in body cell "1" (row 1): the whole-row snap removes that row and
		// the header survives; the chrome end must keep "le" in the chrome leaf.
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

	test('Gate 6d: table → table across the wall — the between chrome clears, never deletes', async ({
		page
	}) => {
		await editor.loadContent(TBL_BOTH_FIXTURE);
		// Outer body cell "1" → inner header cell "c": both endpoints ride the
		// two-table case, and the title sits strictly between — shared-helper coverage.
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
		// Body cell "1" → the container's last byte (end of "Body"): the whole subtree is covered
		// from outside, so the container dies as ONE unit — never a husk with the title deleted.
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

		// One-splice unit delete undoes to the full container, children intact.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['callout-title', 'paragraph']);
		expect((await readCallout(page, 1)).childTexts).toEqual(['Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe(TBL_ABOVE_FIXTURE);
	});
});
