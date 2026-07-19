import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors, FIXTURE_BYTES, cstBlockCount, spacerCount } from './vr-helpers';

// Off-window reveal: Ctrl+Shift+End, scroll, and collapse must reveal, mount, and
// land the caret in a block/cell that was windowed out at load — for flat prose,
// nested list items, and table cells — and undo of an off-window edit must revert
// cleanly with focus restored.

function topLevelHostPresent(page: Page, index: number): Promise<boolean> {
	return page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		index
	);
}

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
	await page.keyboard.press('Control+Shift+End');
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

	// Scroll to the very bottom: the focus pin only keeps block 0 mounted within
	// pinExtensionCap blocks, so a one-viewport scroll wouldn't unmount it. The
	// bottom puts the window's start well past the cap.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// Undo's keydown handler is block-scoped, so a key press needs a focused,
	// mounted block to route to. Scrolling block 0 off-window dropped its focus
	// (the pin blurs past the cap), so focus a block that's actually in the
	// bottom window. Undo itself is editor-global — it targets block 0 regardless
	// of which block holds focus — so the reveal still has to scroll block 0 back.
	const mounted = await mountedTopLevelIndices(page);
	const focusTarget = mounted[Math.floor(mounted.length / 2)];
	expect(focusTarget).toBeGreaterThan(100);
	await editor.focusBlockStart(focusTarget);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	await editor.undo();
	await editor.bridge.waitForSourceNotContains('ALPHA_MARK', 10_000);
	expect(await editor.bridge.getSource()).not.toContain('ALPHA_MARK');

	// The source reverts synchronously, but revealPath remounts block 0 and
	// places the caret a few ticks later. Wait for (and assert) the remount —
	// the reveal's mounting half — before typing, or BETA_MARK could land before
	// the caret is placed. A reveal that never remounts block 0 fails here.
	await page.waitForFunction(() => !!document.querySelector("[data-block-path='[0]']"), null, {
		timeout: 10_000,
		polling: 16
	});
	expect(await topLevelHostPresent(page, 0)).toBe(true);

	// Stronger reveal assertion: the undo's revealPath should have landed the
	// caret back in block 0, so the next type appears there.
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

	// Precondition: the list is windowed AND the deep last leaf is genuinely
	// unmounted, so the marker-at-end assertion can only pass if reveal scrolls and
	// mounts it. Without this the test is vacuous.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	const deepHostPath = JSON.stringify([0, lastItem, 0]);
	expect(
		await page.evaluate((p) => document.querySelector(`[data-block-path='${p}']`), deepHostPath)
	).toBeNull();

	// Real click into the first item's mounted content leaf [0,0,0]. focusBlockStart(0)
	// would target the list CONTAINER ([0] = the non-focusable .list-block div), so its
	// programmatic focus()+range never routes the Ctrl+Shift+End keydown. The deep last
	// leaf is off-window, so it routes through revealPath's async nested descent.
	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('Control+Shift+End');
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

	// The list windows, and this mirrors the table collapse-to-start test for a list
	// scope: the caret lands in the anchor item (not the focus item) and the body
	// survives the collapse. Ctrl+Shift+End scrolls the window to the doc-end focus,
	// so the anchor (item 0) is windowed OUT by collapse time — and its slot holds a
	// stale ref, the conditional-cleanup leftover. Collapse-to-start must drop that
	// stale ref and scroll the anchor back in to mount it; a reveal that trusted the
	// stale slot would skip the scroll and hang, stranding the caret at the focus end.
	expect(await spacerCount(page)).toBeGreaterThan(0);

	await editor.clickBlockAtPath([0, 0, 0], 0);
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	// The doc-end reveal scrolled the anchor off-window: it is unmounted now, so the
	// collapse below must re-reveal it rather than place the caret in a mounted block.
	expect(
		await page.evaluate(() =>
			document.querySelector(`[data-block-path='${JSON.stringify([0, 0, 0])}']`)
		)
	).toBeNull();

	// ArrowLeft collapses the cross-block selection to its start (the row-0 anchor
	// item). waitForCrossBlock(false) before typing: the collapse is async, so typing
	// immediately would race the still-active selection into a destructive type-replace.
	await page.keyboard.press('ArrowLeft');
	await editor.waitForCrossBlock(false);

	await editor.typeText('LIST_START_MARKER');
	await editor.bridge.waitForSourceContains('LIST_START_MARKER', 10_000);

	// The marker lands on source line 0 (the anchor item), not the last line — a
	// wrong-item caret would put it in the focus item.
	const source = await editor.bridge.getSource();
	expect(source.split('\n')[0]).toContain('LIST_START_MARKER');

	// The body must SURVIVE the collapse — a destructive range-replace would wipe
	// the list to a handful of items. CST item count is windowing-independent.
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

	// Scroll-reveal route. The keyboard route (Ctrl+Shift+End → collapse) is
	// covered by the two cross-block tests above; this one proves the same
	// correctness property — scroll windows in a far row, an edit lands there —
	// via the pointer path.

	// Snapshot the initial window's far edge: every asserted target row must be
	// beyond it, so the test can only pass if the scroll mounted a genuinely
	// off-window row.
	const initialMaxRow = await page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-table-row-idx]')).reduce(
			(max, el) => Math.max(max, Number(el.getAttribute('data-table-row-idx'))),
			-1
		)
	);

	// Precondition: windowed AND a far row genuinely unmounted at load, or the
	// assertions below are vacuous.
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight * 0.9));

	// A far row, well past the initial window, that the scroll mounted. Click its
	// first cell, type a marker, and assert both the row idx is off-window and the
	// marker reached the source.
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

	// The marker landed in the far (originally off-window) row's mounted cell, not
	// at the top — scroll-windowing mounted it and the edit reached it.
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

	// Precondition: windowed AND the last row genuinely off-window, or the
	// reveal assertion below is vacuous.
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	expect(
		await page.evaluate((r) => document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBeNull();

	// Real click into the first mounted cell, then Ctrl+Shift+End. The focus
	// normalizes to a cell-coordinate endpoint at the table block; without Fix A
	// the extend scrolls the table top and never mounts the off-window last row.
	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);

	// [data-cross-block] attaches at enterCrossBlock, BEFORE the awaited reveal —
	// wait for the row mount itself, not the cross-block flag.
	await page.waitForFunction(
		(r) => !!document.querySelector(`[data-table-row-idx="${r}"]`),
		lastRow,
		{ timeout: 10_000, polling: 16 }
	);
	expect(
		await page.evaluate((r) => document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).not.toBeNull();
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

	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	expect(
		await page.evaluate((r) => document.querySelector(`[data-table-row-idx="${r}"]`), lastRow)
	).toBeNull();

	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse to the revealed end
	await editor.typeText('TABLE_END_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_END_MARKER', 10_000);

	// Without Fix B the caret lands in the table grid at a meaningless linear
	// offset, so the marker misses the last row's last cell.
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

	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	expect(
		await page.evaluate(
			(r) => document.querySelector(`[data-table-row-idx="${r}"]`),
			rowCountBefore - 1
		)
	).toBeNull();

	// ArrowLeft collapses the cross-block selection to its start (the row-0 anchor
	// cell, off-window after Ctrl+Shift+End scrolled to the bottom). waitForCrossBlock(false)
	// before typing: the collapse is async, so typing immediately would race the
	// still-active selection into a destructive type-replace.
	await page.locator('[data-table-row-idx="0"] [role="cell"]').first().click();
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowLeft'); // collapse to the start
	await editor.waitForCrossBlock(false);

	// The collapse must REVEAL and focus the off-window anchor cell, not leave the
	// caret stranded in the off-window focus cell (the bug: revealByPath gated on a
	// stale ref slot and skipped mounting row 0). Assert the active cell is row 0.
	expect(
		await page.evaluate(() =>
			document.activeElement?.closest('[data-table-row-idx]')?.getAttribute('data-table-row-idx')
		)
	).toBe('0');

	await editor.typeText('TABLE_START_MARKER');
	await editor.bridge.waitForSourceContains('TABLE_START_MARKER', 10_000);

	// The marker lands in row 0's first cell — proving the caret reached the anchor,
	// not the focus cell. (A wrong-cell caret puts the marker in the last row.)
	expect(
		await page.evaluate(() => document.querySelector('[data-table-row-idx="0"]')?.textContent ?? '')
	).toContain('TABLE_START_MARKER');

	// The body must SURVIVE the collapse. A destructive range-replace (the pre-fix
	// behavior) wiped the table to a handful of rows. Assert via the CST row count,
	// which is windowing-independent — only the mounted DOM slice changes.
	const rowCountAfter = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);
	expect(rowCountAfter).toBe(rowCountBefore);
	expect(pageErrors).toEqual([]);
});

// F2: undo must fire when the caret's block has windowed out and NO block holds
// focus (focus fell to the editor root / <body>). The sibling test above
// ('undo of an off-window block edit ...') focuses a still-mounted block before
// Ctrl+Z as the pre-fix workaround; this one deliberately does not — it proves
// the editor-root document-level keydown listener routes undo with nothing
// focused. Reverting that listener leaves the key press inert and the marker in
// place, failing here.
test("undo fires after the caret's block is windowed out (F2)", async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	await editor.focusBlockStart(0);
	await editor.typeText('WINDOWED_MARK');
	await editor.bridge.waitForSourceContains('WINDOWED_MARK');
	await editor.waitForUndoBatchFlush();

	// Scroll block 0 well past the focus pin cap so it unmounts. Past the cap the
	// pin blurs, so native focus leaves the contenteditable entirely.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// The crux of the regression: no mounted block holds focus. The scroll-past-cap
	// pin drops focus before the block unmounts, so it blurs to <body> rather than
	// re-homing to the root. The document-level handler still routes the Ctrl+Z:
	// with no editor focused, the editor the user last interacted with claims a
	// body-level chord (see the containment gate in Editor.svelte). (Pre-fix bug:
	// undo silently inert here.)
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
