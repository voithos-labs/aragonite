import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES, cstBlockCount, spacerCount } from './vr-helpers';
import { capturePageErrors, topLevelHostPresent } from '../../page-probes';

// Reaching an unmounted block: Ctrl+Shift+End, a scroll and a collapse must each mount the
// target and put the caret in a block or cell that was unmounted at load, for flat prose, for
// nested list items and for table cells. Undoing an edit in an unmounted block must restore it
// cleanly, with focus back where it was.

function mountedTopLevelIndices(page: Page): Promise<number[]> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')).map(
			(el) => JSON.parse(el.getAttribute('data-block-path')!)[0] as number
		)
	);
}

test('Ctrl+Shift+End reveals and edits the off-window last block', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	const blockCount = await cstBlockCount(page);
	const last = blockCount - 1;

	// Windowing has to be running and the last block unmounted, or the check for the marker at
	// the end would pass without ever mounting anything.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(await editor.getDomBlockCount()).toBeLessThan(blockCount);
	expect(await topLevelHostPresent(page, last)).toBe(false);

	await editor.focusBlockStart(0);
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse the range to its end
	await editor.typeText('VR_MARKER');
	await editor.bridge.waitForSourceContains('VR_MARKER', 10_000);

	const source = await editor.bridge.getSource();
	expect(source.trimEnd().endsWith('VR_MARKER')).toBe(true);
	expect(pageErrors).toEqual([]);
});

test('undo of an off-window block edit reverts cleanly and restores focus', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	await editor.focusBlockStart(0);
	await editor.typeText('ALPHA_MARK');
	await editor.bridge.waitForSourceContains('ALPHA_MARK');
	await editor.waitForUndoBatchFlush();

	// All the way down: the focused block is kept mounted for up to pinExtensionCap blocks, so
	// scrolling by one viewport would not unmount block 0.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// The keydown handler for undo belongs to a block, so the press needs a mounted focused
	// one; undo itself covers the whole editor, so block 0 must still be scrolled back.
	const mounted = await mountedTopLevelIndices(page);
	const focusTarget = mounted[Math.floor(mounted.length / 2)];
	expect(focusTarget).toBeGreaterThan(100);
	await editor.focusBlockStart(focusTarget);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	await editor.undo();
	await editor.bridge.waitForSourceNotContains('ALPHA_MARK', 10_000);
	expect(await editor.bridge.getSource()).not.toContain('ALPHA_MARK');

	// The source is restored at once, but mounting the block and placing the caret happen a few
	// ticks later, so typing as soon as the source settles would race the caret.
	await page.waitForFunction(() => !!document.querySelector("[data-block-path='[0]']"), null, {
		timeout: 10_000,
		polling: 16
	});
	expect(await topLevelHostPresent(page, 0)).toBe(true);

	// Where the next character lands is the other half of this: mounting alone is not enough.
	await editor.typeText('BETA_MARK');
	await editor.bridge.waitForSourceContains('BETA_MARK', 10_000);
	expect(await editor.getBlockText(0)).toContain('BETA_MARK');
	expect(pageErrors).toEqual([]);
});

test('reveals a deep off-window nested item and lands the caret there', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-list', 2_000_000);

	// The deepest last block sits at [0, lastItem, 0]: the list, its last item, its paragraph.
	const lastItem = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length - 1
	);

	// Unless that deepest block really is unmounted, the check for the marker at the end can
	// pass without anything having been mounted.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	const deepHostPath = JSON.stringify([0, lastItem, 0]);
	expect(
		await page.evaluate((p) => !!document.querySelector(`[data-block-path='${p}']`), deepHostPath)
	).toBe(false);

	// Click the paragraph rather than calling focusBlockStart(0): path [0] is the `.list-block`
	// container, which cannot take focus, so a keydown there goes nowhere.
	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse the range to its newly mounted end
	await editor.typeText('DEEP_VR_MARKER');
	await editor.bridge.waitForSourceContains('DEEP_VR_MARKER', 10_000);

	const source = await editor.bridge.getSource();
	expect(source.trimEnd().endsWith('DEEP_VR_MARKER')).toBe(true); // in the last item, not the first
	expect(pageErrors).toEqual([]);
});

test('collapsing a Ctrl+Shift+End list selection to start lands the caret in the anchor item', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-list', 2_000_000);

	const itemCountBefore = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// The list version of the table collapse-to-start case below. Ctrl+Shift+End unmounts the
	// block the selection started in and leaves a stale reference behind; trusting that
	// reference would skip the scroll and leave the caret at the other end.
	expect(await spacerCount(page)).toBeGreaterThan(0);

	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);
	// Unmounted now, so the collapse below has to mount it again rather than reuse a block.
	expect(
		await page.evaluate(
			() => !!document.querySelector(`[data-block-path='${JSON.stringify([0, 0, 0])}']`)
		)
	).toBe(false);

	// The collapse is asynchronous: typing straight after the keypress would race the still
	// live selection and replace it instead.
	await page.keyboard.press('ArrowLeft');
	await editor.waitForCrossBlock(false);

	await editor.typeText('LIST_START_MARKER');
	await editor.bridge.waitForSourceContains('LIST_START_MARKER', 10_000);

	// Line 0 is the item the selection started in; a caret in the wrong item puts the marker
	// in the other one.
	const source = await editor.bridge.getSource();
	expect(source.split('\n')[0]).toContain('LIST_START_MARKER');

	// Replacing the range instead would cut the list down to a few items. Counted on the tree,
	// which does not depend on what is mounted.
	const itemCountAfter = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);
	expect(itemCountAfter).toBe(itemCountBefore);
	expect(pageErrors).toEqual([]);
});

test('reveals an off-window table cell by scroll and edits it (phase 4)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	// The same behaviour the cross-block cases above reach by keyboard, reached by pointer.

	// Every row checked must sit past this edge, or the scroll mounted nothing new.
	const initialMaxRow = await page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-table-row-idx]')).reduce(
			(max, el) => Math.max(max, Number(el.getAttribute('data-table-row-idx'))),
			-1
		)
	);

	// Without windowing no row is unmounted and the checks below prove nothing.
	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight * 0.9));

	// Pick from the middle of the far stretch, so the choice is not on the window's edge.
	const target = await page.evaluate((initialMax) => {
		const rows = Array.from(document.querySelectorAll('[data-table-row-idx]')) as HTMLElement[];
		const far = rows
			.map((r) => Number(r.getAttribute('data-table-row-idx')))
			.filter((idx) => idx > initialMax + 10)
			.sort((a, b) => a - b);
		return far[Math.floor(far.length / 2)] ?? null;
	}, initialMaxRow);
	expect(target).not.toBeNull();
	expect(target!).toBeGreaterThan(initialMaxRow + 10);

	await page.locator(`[data-table-row-idx="${target}"] [role="cell"]`).first().click();
	await editor.typeText('CELL_VR_MARKER');
	await editor.bridge.waitForSourceContains('CELL_VR_MARKER', 10_000);

	// Checked on the far row itself: a caret that fell back to the top would still put the
	// marker somewhere in the source.
	expect(
		await page.evaluate(
			(t) => document.querySelector(`[data-table-row-idx="${t}"]`)?.textContent ?? '',
			target
		)
	).toContain('CELL_VR_MARKER');
	expect((await editor.bridge.getSource()).includes('CELL_VR_MARKER')).toBe(true);
	expect(pageErrors).toEqual([]);
});

test('Ctrl+Shift+End in a table reveals and mounts the off-window focus cell (phase 4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const lastRow = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length - 1
	);

	// If the last row is already mounted, the check below proves nothing.
	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);
	expect(
		await page.evaluate((r) => !!document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBe(false);

	// The focus ends up as a cell position on the table block; an extend that ignores the cell
	// scrolls to the top of the table and never mounts the last row.
	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);

	// [data-cross-block] is added in enterCrossBlock, before the scroll finishes, so wait for
	// the row to mount rather than for that attribute.
	await page.waitForFunction(
		(r) => !!document.querySelector(`[data-table-row-idx="${r}"]`),
		lastRow,
		{ timeout: 10_000, polling: 16 }
	);
	expect(
		await page.evaluate((r) => !!document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBe(true);
	expect(pageErrors).toEqual([]);
});

test('collapsing a Ctrl+Shift+End table selection lands the caret in the revealed cell (phase 4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const lastRow = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length - 1
	);

	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);
	expect(
		await page.evaluate((r) => !!document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBe(false);

	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse to the newly mounted end
	await editor.typeText('TABLE_END_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_END_MARKER', 10_000);

	// A caret placed by counting through the grid rather than by cell misses the last row's
	// last cell entirely.
	expect(
		await page.evaluate(
			(r) => document.querySelector(`[data-table-row-idx="${r}"]`)?.textContent ?? '',
			lastRow
		)
	).toContain('TABLE_END_MARKER');
	expect(pageErrors).toEqual([]);
});

test('collapsing a Ctrl+Shift+End table selection to start does not wipe the table body (phase 4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const rowCountBefore = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);
	expect(
		await page.evaluate(
			(r) => !!document.querySelector(`[data-table-row-idx="${r}"]`),
			rowCountBefore - 1
		)
	).toBe(false);

	// The collapse is async: typing on the keypress alone would race the still-active
	// selection into a destructive type-replace.
	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowLeft'); // collapse to the start
	await editor.waitForCrossBlock(false);

	// Trusting a stale reference here skips mounting row 0 and leaves the caret in the other
	// cell.
	expect(
		await page.evaluate(() =>
			document.activeElement?.closest('[data-table-row-idx]')?.getAttribute('data-table-row-idx')
		)
	).toBe('0');

	await editor.typeText('TABLE_START_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_START_MARKER', 10_000);

	// A caret in the wrong cell puts the marker in the last row instead.
	expect(
		await page.evaluate(() => document.querySelector('[data-table-row-idx="0"]')?.textContent ?? '')
	).toContain('TABLE_START_MARKER');

	// Replacing the range instead would cut the table down to a few rows. Counted on the tree,
	// which does not depend on what is mounted.
	const rowCountAfter = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);
	expect(rowCountAfter).toBe(rowCountBefore);
	expect(pageErrors).toEqual([]);
});

// F2: undo with no block focused at all. The case above focuses a still-mounted block first;
// this one deliberately does not, so only the editor's own document-level keydown listener can
// deliver the shortcut. Without that listener the press does nothing.
test("undo fires after the caret's block is windowed out (F2)", async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	await editor.focusBlockStart(0);
	await editor.typeText('WINDOWED_MARK');
	await editor.bridge.waitForSourceContains('WINDOWED_MARK');
	await editor.waitForUndoBatchFlush();

	// Past the limit on keeping the focused block mounted, focus leaves the editable entirely.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// The point: focus moved to <body> rather than back to the editor root, so the shortcut is
	// taken by the editor last interacted with (the check in Editor.svelte).
	const noBlockFocused = await page.evaluate(() => {
		const active = document.activeElement;
		return active === document.body || active === document.querySelector('.editor');
	});
	expect(noBlockFocused).toBe(true);

	await editor.undo();
	await editor.bridge.waitForSourceNotContains('WINDOWED_MARK', 10_000);
	expect(await editor.bridge.getSource()).not.toContain('WINDOWED_MARK');
	expect(pageErrors).toEqual([]);
});
