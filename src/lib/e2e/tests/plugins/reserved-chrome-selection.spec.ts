import { test, expect } from '../../fixtures';
import {
	PluginsPage,
	readCallout,
	activeBlockPath,
	capturedErrors,
	FIXTURE
} from './reserved-chrome-helpers';

/**
 * The `:::callout` callout reserves child 0 as an editable `callout-title` chrome leaf (see
 * src/routes/test/plugins/callout). Gate 1 — selection parity: a cross-block selection from the
 * paragraph above paints continuously INTO the title, and caret/undo land there, with zero new
 * selection machinery (the title carries a char offset, so none of the `kind === 'table'`
 * coordinate gates fire).
 */
test.describe('Fork-A spike — reserved child-0 chrome: selection parity', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('substrate: the title parses as a reserved child-0 callout-title leaf', async ({ page }) => {
		await editor.loadContent(FIXTURE);
		const callout = await readCallout(page, 1);
		expect(callout.kind).toBe('callout');
		expect(callout.rootCount).toBe(2);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['Title', 'Body']);
		// Non-strip container: raw carries the title in the opener line, and the
		// document still round-trips (raw is authoritative for serialization).
		expect(callout.raw).toBe(':::callout Title\nBody\n:::\n');
		expect(await editor.bridge.getSource()).toBe(FIXTURE);
		expect(await capturedErrors(page)).toEqual([]);
	});

	// ── Gate 1 — selection parity ────────────────────────────────────────────

	test('Gate 1: keyboard Shift+ArrowDown paints one span from the paragraph into the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		// Anchor mid-paragraph, extend to the paragraph end, then cross the boundary —
		// the span covers the paragraph tail AND reaches into the callout.
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		// The selection reaches the reserved chrome leaf (deep path [1, 0]), proving
		// cross-select-in with zero new selection machinery.
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
		// The default reserved slot: a callout whose author has not typed a title.
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
		// An empty child-0 leaf is still a real selection endpoint.
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

		// Collapse to the focus edge (the title), then type — the character must land in the
		// child-0 leaf, proving it is a real caret target. (The callout-title kind survives the edit
		// via contextDependentKind, characterized separately; this gate is about the caret reaching
		// path [1, 0].)
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

		// Poll the CST child text, not the source bytes: this epilogue is where the source-bytes
		// wait once won the race a beat before the title child re-materialized, so readCallout saw a
		// childless callout.
		await editor.undo();
		await expect.poll(() => readCallout(page, 1).then((n) => n.childTexts[0])).toBe('Title');
		// Undo's selection restore returns the caret to the title leaf.
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
