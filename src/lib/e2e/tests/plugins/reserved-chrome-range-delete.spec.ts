import { test, expect } from '../../fixtures';
import {
	PluginsPage,
	readCallout,
	activeBlockPath,
	capturedErrors,
	stateConsistencyViolations,
	FIXTURE
} from './reserved-chrome-helpers';
import { extendKey } from '../../platform-keys';

/**
 * The `:::callout` callout holds its opener line as child 0, an editable title row (see
 * src/routes/test/plugins/callout). Part 4, the boundary rangeDelete stops at: nothing merges
 * across it. An endpoint outside truncates in place, a title the range covers is emptied rather
 * than removed, and the container goes only when the range covers its whole subtree from outside.
 * A range inside the body alone takes the ordinary path.
 */
test.describe('reserved child-0 chrome: rangeDelete wall', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	// ── Part 4: the boundary rangeDelete stops at ────────────────────────────

	// Two body children, so truncating in place is distinguishable from merging upward, plus a
	// trailing paragraph to end a range outside the container.
	const WALL_FIXTURE = 'Above\n\n:::callout Title\nBody1\n\nBody2\n:::\n\nBelow\n';

	test('Gate 4a: Delete over a selection covering the whole title clears the chrome, never deleting it', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.dragFromTo([0], 2, [1, 0], 16);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout\n');

		// "Above" keeps its start as a paragraph, the covered title is emptied rather than removed, and
		// the body never moves up into the opener line.
		const callout = await readCallout(page, 1);
		expect(callout.rootCount).toBe(2);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['directiveOpenerLine', 'paragraph']);
		expect(callout.childTexts).toEqual([':::callout', 'Body']);
		expect(callout.raw).toBe(':::callout\nBody\n:::\n');
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['directiveOpenerLine', 'paragraph']);
		expect(await editor.bridge.getSource()).toBe(FIXTURE);
	});

	test('Gate 4a (gesture parity): the historical Delete-into-title keyboard gesture no longer corrupts the chrome', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlock(0, 2);
		await page.keyboard.press(extendKey('lineEnd'));
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('Ab\n');

		// Keeping the column puts the focus at title offset 0, so the range covers no title text:
		// "Above" truncates in place and the title stays.
		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['directiveOpenerLine', 'paragraph']);
		expect(callout.childTexts).toEqual([':::callout Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout Title\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 4c: chrome-between; start truncates, chrome clears, end body child keeps its tail in place', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([0], 2, [1, 1], 2);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceEquals('Ab\n\n:::callout\ndy1\n\nBody2\n:::\n\nBelow\n');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['directiveOpenerLine', 'paragraph', 'paragraph']);
		expect(callout.childTexts).toEqual([':::callout', 'dy1', 'Body2']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout\ndy1\n\nBody2\n:::\n\nBelow\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// The title was emptied through a copy made before the write (G1.9), so undo restores the node
		// itself, which `getSource` cannot show; polling the child's text waits for the rebuild.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childTexts[0]))
			.toBe(':::callout Title');
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test('Gate 4d: start-in-chrome; title keeps its head, body deletes, container survives title-only', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([1, 0], 14, [2], 3);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceEquals('Above\n\n:::callout Tit\n:::\n\now\n');

		const callout = await readCallout(page, 1);
		expect(callout.childCount).toBe(1);
		expect(callout.childKinds).toEqual(['directiveOpenerLine']);
		expect(callout.childTexts).toEqual([':::callout Tit']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::callout Tit\n:::\n\now\n');
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		// Going from three children to one is the harder case for BlockListState: the ids and
		// references must still match the surviving children after the splice.
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['directiveOpenerLine', 'paragraph', 'paragraph']);
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test("Gate 4f: a range ending exactly at the container's last byte also deletes it as a unit", async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([0], 5, [1, 2], 5);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains(':::callout');

		expect(await editor.bridge.getSource()).toBe('Above\n\nBelow\n');
		// Removing the whole container from the root: the top-level BlockListState still matches
		// after that single-splice delete.
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// That single-splice delete undoes cleanly to the full container, children intact.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childTexts))
			.toEqual([':::callout Title', 'Body1', 'Body2']);
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test('Gate 4g: a body-only range never fires the wall; type-over merges exactly like a blockquote', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([1, 1], 2, [1, 2], 3);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('BoZy2');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['directiveOpenerLine', 'paragraph']);
		expect(callout.childTexts).toEqual([':::callout Title', 'BoZy2']);

		// The same gesture over a container that declares no title row: the ordinary path handles
		// both alike, which shows the rule applies only where a title row is declared.
		await editor.loadContent('Above\n\n> Body1\n>\n> Body2\n\nBelow\n');
		await editor.dragFromTo([1, 0], 2, [1, 1], 3);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('BoZy2');
		expect((await readCallout(page, 1)).childTexts).toEqual(['BoZy2']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 4h: an inside-only selection over the whole callout empties it to a blank title + blank body', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		// Covered from inside, the container keeps an emptied title and an empty body paragraph; the
		// cut clamps to the title's start, so `:::callout ` keeps its space for a typed title.
		await editor.dragFromTo([1, 0], 0, [1, 1], 4);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout \n');

		const callout = await readCallout(page, 1);
		expect(callout.rootCount).toBe(2);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['directiveOpenerLine', 'paragraph']);
		expect(callout.childTexts).toEqual([':::callout ', '']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::callout \n\n:::\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
