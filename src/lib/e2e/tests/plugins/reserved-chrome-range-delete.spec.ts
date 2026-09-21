import { test, expect } from '../../fixtures';
import {
	PluginsPage,
	readCallout,
	activeBlockPath,
	capturedErrors,
	stateConsistencyViolations,
	FIXTURE
} from './reserved-chrome-helpers';

/**
 * The `:::callout` callout reserves child 0 as an editable `callout-title` row (see
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
		await editor.dragFromTo([0], 2, [1, 0], 5);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout\n');

		// The boundary rule: "Above" keeps its start as its own paragraph, the fully covered title
		// survives as an empty callout-title, emptied rather than removed, and the body never
		// moves up into the opener line.
		const callout = await readCallout(page, 1);
		expect(callout.rootCount).toBe(2);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['', 'Body']);
		expect(callout.raw).toBe(':::callout\nBody\n:::\n');
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['callout-title', 'paragraph']);
		expect(await editor.bridge.getSource()).toBe(FIXTURE);
	});

	test('Gate 4a (gesture parity): the historical Delete-into-title keyboard gesture no longer corrupts the chrome', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('Ab\n');

		// Keeping the column puts the focus at title offset 0, so the range covers no title text:
		// the boundary truncates "Above" in place and leaves the title alone, where the older path
		// removed the title node and moved "Body" up into the opener line.
		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout Title\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 4b: partial title coverage keeps the tail in the chrome, never merged upward', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.dragFromTo([0], 2, [1, 0], 3);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout le');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['le', 'Body']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout le\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 4c: chrome-between — start truncates, chrome clears, end body child keeps its tail in place', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([0], 2, [1, 1], 2);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceEquals('Ab\n\n:::callout\ndy1\n\nBody2\n:::\n\nBelow\n');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph', 'paragraph']);
		expect(callout.childTexts).toEqual(['', 'dy1', 'Body2']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::callout\ndy1\n\nBody2\n:::\n\nBelow\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// The title was emptied through a copy made before the write (G1.9), so undo restores the
		// title node itself, not only the container's source bytes, which `getSource` reads and
		// would look right even with a corrupted title. Poll the child's text so the assertion
		// waits for the tree to rebuild rather than for the bytes alone to match.
		await editor.undo();
		await expect.poll(() => readCallout(page, 1).then((n) => n.childTexts[0])).toBe('Title');
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test('Gate 4d: start-in-chrome — title keeps its head, body deletes, container survives title-only', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([1, 0], 3, [2], 3);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceEquals('Above\n\n:::callout Tit\n:::\n\now\n');

		const callout = await readCallout(page, 1);
		expect(callout.childCount).toBe(1);
		expect(callout.childKinds).toEqual(['callout-title']);
		expect(callout.childTexts).toEqual(['Tit']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::callout Tit\n:::\n\now\n');
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		// Going from three children to one is the harder case for BlockListState: the ids and
		// references must still match the surviving children after the splice.
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childKinds))
			.toEqual(['callout-title', 'paragraph', 'paragraph']);
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test('Gate 4e: a range strictly around the container still deletes it as a unit', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([0], 5, [2], 3);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains(':::callout');

		expect(await editor.bridge.getSource()).toBe('Aboveow\n');
		expect(await capturedErrors(page)).toEqual([]);
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
			.toEqual(['Title', 'Body1', 'Body2']);
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test('Gate 4g: a body-only range never fires the wall — type-over merges exactly like a blockquote', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([1, 1], 2, [1, 2], 3);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('BoZy2');

		const callout = await readCallout(page, 1);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['Title', 'BoZy2']);

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
		// Drag from the title's start through the body's end: a range wholly inside that covers
		// the entire subtree without crossing the boundary from outside. The boundary keeps the
		// container alive, so the title is emptied in place and the fully covered body truncates
		// to an empty paragraph, leaving child 0 a title row rather than a bare paragraph, which
		// is what G1.14 requires.
		await editor.dragFromTo([1, 0], 0, [1, 1], 4);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout\n');

		const callout = await readCallout(page, 1);
		expect(callout.rootCount).toBe(2);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['', '']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::callout\n\n:::\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
