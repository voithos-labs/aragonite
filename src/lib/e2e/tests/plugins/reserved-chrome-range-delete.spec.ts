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
 * The `:::callout` callout reserves child 0 as an editable `callout-title` chrome leaf (see
 * src/routes/test/plugins/callout). Gate 4 — the rangeDelete chrome wall: nothing merges across the
 * callout's wall. Outside endpoints truncate in place, covered chrome clears (never node-deletes), and
 * the container dies only when the range consumes its whole subtree from outside. Body-only ranges
 * stay on the generic path.
 */
test.describe('Fork-A spike — reserved child-0 chrome: rangeDelete wall', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	// ── Gate 4 — rangeDelete chrome wall ─────────────────────────────────────

	// Two body children so in-place truncation is distinguishable from an upward
	// merge, plus a trailing paragraph as an outside end anchor.
	const WALL_FIXTURE = 'Above\n\n:::callout Title\nBody1\n\nBody2\n:::\n\nBelow\n';

	test('Gate 4a: Delete over a selection covering the whole title clears the chrome, never deleting it', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.dragFromTo([0], 2, [1, 0], 5);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::callout\n');

		// The wall rule: "Above" keeps its head as its own paragraph, the fully covered title
		// survives as an EMPTY callout-title (cleared, not deleted), and the body never hoists into
		// the opener line.
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

		// Sticky column lands the focus at title offset 0, so the range covers no title text: the
		// wall truncates "Above" in place and leaves the chrome intact — where the pre-contract
		// path deleted the title node and hoisted "Body" into the opener line.
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

		// The cleared chrome cleared through an unshared copy (G1.9), so undo restores the title at
		// the CHILD level — not just the container's authoritative source bytes, which `getSource`
		// reads and would show even with a corrupted title node. Poll the child text so the assert
		// waits for the CST to re-materialize, not just the serialized bytes to match.
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
		// Children 3→1 is the harsher BlockListState case: ids/refs must stay in
		// lockstep with the surviving children after the deep splice.
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
		// Root splice removing the whole container: the top-level BlockListState
		// stays in lockstep after the one-splice unit delete.
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// One-splice unit delete undoes cleanly back to the full container, children intact.
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

		// Same gesture over an undeclared container: the generic path handles both
		// identically, proving the gate is scoped to declared chrome.
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
		// Drag from the title start through the body end — an inside-only range that covers the
		// entire subtree WITHOUT crossing the wall from outside. The wall keeps the container
		// alive: the title clears in place and the fully-covered body truncates to an empty
		// paragraph, so the reserved slot holds chrome (not a bare paragraph) and G1.14 stays
		// satisfied.
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
