import { test, expect } from '../../fixtures';
import {
	PluginsPage,
	readCallout,
	activeBlockPath,
	capturedErrors,
	FIXTURE
} from './reserved-chrome-helpers';

/**
 * The `:::callout` callout reserves child 0 as an editable `callout-title` row (see
 * src/routes/test/plugins/callout). Part 1, the selection behaving like any other: a cross-block
 * selection from the paragraph above paints straight into the title, and the caret and undo land
 * there, with no new selection code. The title holds a character offset, so none of the
 * `kind === 'table'` coordinate checks fire.
 */
test.describe('reserved child-0 chrome: selection parity', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	// ── Part 1: the selection behaves like any other ─────────────────────────

	test('Gate 1: keyboard Shift+ArrowDown paints one span from the paragraph into the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		// Anchor mid-paragraph, extend to the paragraph's end, then cross the boundary, so the
		// range covers the end of the paragraph and reaches into the callout.
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		// The selection reaches the title row at path [1, 0], so selecting into it needs no new
		// selection code.
		expect(sel!.focus.path).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1: pointer drag from the paragraph into the title is cross-block', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.dragFromTo([0], 2, [1, 0], 3);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1 (edge): cross-select-in reaches child 0 even when the title is empty', async ({
		page
	}) => {
		// The default title row: a callout whose author has not typed a title.
		await editor.loadContent('Above\n\n:::callout\nBody\n:::\n');
		const seed = await readCallout(page, 1);
		expect(seed.childKinds[0]).toBe('callout-title');
		expect(seed.childTexts[0]).toBe('');

		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		// An empty child 0 is still a real endpoint for a selection.
		expect(sel!.focus.path).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1: collapsing the cross-block selection lands the caret in the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		// The typed character lands in child 0, showing the caret can reach path [1, 0]; that the title
		// keeps its kind is covered elsewhere.
		await page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.typeText('Z');
		await editor.bridge.waitForSource((s) => /:::callout [^\n]*Z/.test(s));

		const callout = await readCallout(page, 1);
		expect(callout.childTexts[0]).toContain('Z');
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1: undo restores a title edit and lands the caret back in the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains(':::callout Title!');
		await editor.waitForUndoBatchFlush();

		// Polls the CST child, not the bytes, which can finish before the title child is rebuilt.
		await editor.undo();
		await expect.poll(() => readCallout(page, 1).then((n) => n.childTexts[0])).toBe('Title');
		// Undo restores the selection, so the caret returns to the title row.
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
