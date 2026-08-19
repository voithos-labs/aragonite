import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES, cstBlockCount, spacerCount } from './vr-helpers';
import { capturePageErrors, topLevelHostPresent } from '../../page-probes';

// Off-window reveal: Ctrl+Shift+End, scroll, and collapse must reveal, mount, and
// land the caret in a block/cell that was windowed out at load — for flat prose,
// nested list items, and table cells — and undo of an off-window edit must revert
// cleanly with focus restored.

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

	// Precondition: windowing must be active and the last block off-window, or the
	// marker-at-end assertion would pass without ever hitting reveal.
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

	// All the way down: the focus pin keeps block 0 mounted within pinExtensionCap blocks,
	// so a one-viewport scroll would not unmount it.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// Undo's keydown handler is block-scoped, so the press needs a mounted focused block;
	// undo itself is editor-global, so the reveal must still scroll block 0 back.
	const mounted = await mountedTopLevelIndices(page);
	const focusTarget = mounted[Math.floor(mounted.length / 2)];
	expect(focusTarget).toBeGreaterThan(100);
	await editor.focusBlockStart(focusTarget);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	await editor.undo();
	await editor.bridge.waitForSourceNotContains('ALPHA_MARK', 10_000);
	expect(await editor.bridge.getSource()).not.toContain('ALPHA_MARK');

	// The source reverts synchronously but revealPath remounts and places the caret a few
	// ticks later, so typing on the source settle alone would race the caret placement.
	await page.waitForFunction(() => !!document.querySelector("[data-block-path='[0]']"), null, {
		timeout: 10_000,
		polling: 16
	});
	expect(await topLevelHostPresent(page, 0)).toBe(true);

	// Where the next type lands is the reveal's caret half — remounting alone is not enough.
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

	// The deep last leaf lives at [0, lastItem, 0] (list → last item → its paragraph).
	const lastItem = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length - 1
	);

	// Unless the deep last leaf is genuinely unmounted, the marker-at-end assertion below
	// can pass without reveal ever running.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	const deepHostPath = JSON.stringify([0, lastItem, 0]);
	expect(
		await page.evaluate((p) => !!document.querySelector(`[data-block-path='${p}']`), deepHostPath)
	).toBe(false);

	// Click the content leaf, not focusBlockStart(0): path [0] is the non-focusable
	// .list-block container, whose programmatic focus never routes the keydown.
	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse the range to the revealed end
	await editor.typeText('DEEP_VR_MARKER');
	await editor.bridge.waitForSourceContains('DEEP_VR_MARKER', 10_000);

	const source = await editor.bridge.getSource();
	expect(source.trimEnd().endsWith('DEEP_VR_MARKER')).toBe(true); // landed in the LAST item, not item 0
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

	// The list-scope twin of the table collapse-to-start test below. Ctrl+Shift+End windows
	// the anchor OUT and leaves a stale ref in its slot; a reveal that trusted that slot
	// would skip the scroll and strand the caret at the focus end.
	expect(await spacerCount(page)).toBeGreaterThan(0);

	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);
	// Unmounted now, so the collapse below must re-reveal rather than reuse a mounted block.
	expect(
		await page.evaluate(
			() => !!document.querySelector(`[data-block-path='${JSON.stringify([0, 0, 0])}']`)
		)
	).toBe(false);

	// The collapse is async: typing on the keypress alone would race the still-active
	// selection into a destructive type-replace.
	await page.keyboard.press('ArrowLeft');
	await editor.waitForCrossBlock(false);

	await editor.typeText('LIST_START_MARKER');
	await editor.bridge.waitForSourceContains('LIST_START_MARKER', 10_000);

	// Line 0 is the anchor item; a wrong-item caret puts the marker in the focus item.
	const source = await editor.bridge.getSource();
	expect(source.split('\n')[0]).toContain('LIST_START_MARKER');

	// A destructive range-replace would wipe the list to a handful of items. Counted on
	// the CST, which is windowing-independent.
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

	// The pointer route to the property the cross-block tests above reach by keyboard.

	// Every asserted target row must sit beyond this edge, or the scroll never mounted
	// anything that was off-window.
	const initialMaxRow = await page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-table-row-idx]')).reduce(
			(max, el) => Math.max(max, Number(el.getAttribute('data-table-row-idx'))),
			-1
		)
	);

	// Without windowing there is no off-window row and the assertions below are vacuous.
	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight * 0.9));

	// Pick from the middle of the far band so the choice does not sit on a window edge.
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

	// Asserted on the far row itself: a caret that fell back to the top would still put
	// the marker in the source.
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

	// If the last row is already mounted the reveal assertion below is vacuous.
	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);
	expect(
		await page.evaluate((r) => !!document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBe(false);

	// The focus normalizes to a cell-coordinate endpoint at the table block; an extend that
	// ignores the cell coordinate scrolls the table top and never mounts the last row.
	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForCrossBlock(true);

	// [data-cross-block] attaches at enterCrossBlock, BEFORE the awaited reveal —
	// wait for the row mount itself, not the cross-block flag.
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
	await page.keyboard.press('ArrowRight'); // collapse to the revealed end
	await editor.typeText('TABLE_END_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_END_MARKER', 10_000);

	// A caret placed at a linear grid offset rather than a cell coordinate misses the last
	// row's last cell entirely.
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

	// A revealByPath that gates on a stale ref slot skips mounting row 0 and strands the
	// caret in the focus cell.
	expect(
		await page.evaluate(() =>
			document.activeElement?.closest('[data-table-row-idx]')?.getAttribute('data-table-row-idx')
		)
	).toBe('0');

	await editor.typeText('TABLE_START_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_START_MARKER', 10_000);

	// A wrong-cell caret puts the marker in the last row instead.
	expect(
		await page.evaluate(() => document.querySelector('[data-table-row-idx="0"]')?.textContent ?? '')
	).toContain('TABLE_START_MARKER');

	// A destructive range-replace would wipe the table to a handful of rows. Counted on
	// the CST, which is windowing-independent.
	const rowCountAfter = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);
	expect(rowCountAfter).toBe(rowCountBefore);
	expect(pageErrors).toEqual([]);
});

// F2: undo with NO block focused at all. The sibling test above focuses a still-mounted
// block first; this one deliberately does not, so only the editor-root document-level
// keydown listener can route the chord. Reverting that listener leaves the press inert.
test("undo fires after the caret's block is windowed out (F2)", async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	await editor.focusBlockStart(0);
	await editor.typeText('WINDOWED_MARK');
	await editor.bridge.waitForSourceContains('WINDOWED_MARK');
	await editor.waitForUndoBatchFlush();

	// Past the pin cap the pin blurs, so native focus leaves the contenteditable entirely.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// The crux: focus blurred to <body> rather than re-homing to the root, so the chord is
	// claimed by the last-interacted editor (the containment gate in Editor.svelte).
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
