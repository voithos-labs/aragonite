import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES, cstBlockCount } from '../perf/vr-helpers';

/**
 * Public rect API (requirements/decorations/rect-api.md). Driven through the e2e
 * bridge's `__test.rects`, which delegates to the instance door `editor.getRects()`.
 * These live in e2e, not a unit suite, because rects are real only in a browser —
 * jsdom reports ~0-sized boxes, so geometry assertions there prove nothing.
 */

type PlainRect = { top: number; left: number; width: number; height: number } | null;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

async function blockRect(page: EditorPage['page'], path: number[]): Promise<PlainRect> {
	return page.evaluate((p) => {
		const r = (window as any).__test.rects.blockRect(p);
		return r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
	}, path);
}

async function rangeRects(
	page: EditorPage['page'],
	path: number[],
	start: number,
	end: number
): Promise<PlainRect[]> {
	return page.evaluate(
		({ path, start, end }) =>
			((window as any).__test.rects.rangeRects(path, start, end) as DOMRect[]).map((r) => ({
				top: r.top,
				left: r.left,
				width: r.width,
				height: r.height
			})),
		{ path, start, end }
	);
}

async function caretRect(page: EditorPage['page']): Promise<PlainRect> {
	return page.evaluate(() => {
		const r = (window as any).__test.rects.caretRect();
		return r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
	});
}

type CrossBlockCaretProbe = { captured: boolean; rect: PlainRect };

test.describe('public rect api', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('blockRect returns a thematic break box', async ({ page }) => {
		await editor.loadContent('intro line\n\n---\n\ntrailing line\n');
		const rect = await blockRect(page, [1]);
		expect(rect).not.toBeNull();
		expect(rect!.width).toBeGreaterThan(0);
	});

	test('rangeRects over a soft-wrapped paragraph returns one rect per visual line', async ({
		page
	}) => {
		const line = 'word '.repeat(120).trim();
		await editor.loadContent(`${line}\n`);
		// SELECTION_END (MAX_SAFE_INTEGER) as end — text surfaces clamp it to the block's end.
		const rects = await rangeRects(page, [0], 0, MAX_SAFE);
		expect(rects.length).toBeGreaterThanOrEqual(2);
		expect(rects.every((r) => r!.width > 0)).toBe(true);
	});

	test('rangeRects on a heading measures raw offsets, marker included', async ({ page }) => {
		await editor.loadContent('## Heading\n');
		// Raw offsets: 0..1 is the first dimmed `#`; 3..4 is the visible `H`. Marker-inclusive
		// offsets put the `#` rect left of the `H` rect. If offsets counted visible text only,
		// offset 0 would land on `H` and the two lefts would coincide.
		const markerRects = await rangeRects(page, [0], 0, 1);
		const letterRects = await rangeRects(page, [0], 3, 4);
		expect(markerRects.length).toBeGreaterThan(0);
		expect(letterRects.length).toBeGreaterThan(0);
		expect(markerRects[0]!.left).toBeLessThan(letterRects[0]!.left);
	});

	test('rangeRects addressing a table by cell-index range returns cell rects', async ({ page }) => {
		await editor.loadContent('| Name | Role |\n| :--- | :--- |\n| Ada | dev |\n');
		// Path [0] is the table; on a grid surface start/end are flat cell indices, so 0..2
		// covers the two header cells (row 0, cols 0 and 1) → two whole-cell rects.
		const rects = await rangeRects(page, [0], 0, 2);
		expect(rects.length).toBe(2);
		expect(rects.every((r) => r!.width > 0)).toBe(true);
	});

	test('caretRect lands near a clicked position', async ({ page }) => {
		await editor.loadContent('measure this caret\n');
		const point = await editor.pointForOffset([0], 8);
		await page.mouse.click(point.x, point.y);
		await editor.waitForRenderFlush();

		const rect = await caretRect(page);
		expect(rect).not.toBeNull();
		expect(Math.abs(rect!.left - point.x)).toBeLessThan(6);
		expect(Math.abs(rect!.top + rect!.height / 2 - point.y)).toBeLessThan(10);
	});

	test('caretRect is null while a cross-block selection is active', async ({ page }) => {
		await editor.loadContent('first block\n\nsecond block\n');
		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([1], 6);
		await editor.waitForCrossBlock(true);

		expect(await caretRect(page)).toBeNull();
	});

	test('caretRect is null inside a selectionChange handler during cross-block entry', async ({
		page
	}) => {
		await editor.loadContent('first block\n\nsecond block\n');
		await editor.focusBlockEnd(0);

		// Subscribe before the gesture: the probe records caretRect() from inside
		// the SYNCHRONOUS selectionChange emit, the window before the deferred
		// data-cross-block $effect writes the attribute. If caretRect gated on the
		// attribute it would still read unset here and leak the parked range's box.
		await page.evaluate(() => (window as any).__test.startCrossBlockCaretProbe());
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const probe = await page.evaluate(
			() => (window as any).__test.readCrossBlockCaretProbe() as CrossBlockCaretProbe
		);
		// captured guards against a false green where the handler never fired.
		expect(probe.captured).toBe(true);
		expect(probe.rect).toBeNull();
	});

	test('caretRect is null when nothing is focused', async ({ page }) => {
		await editor.loadContent('unfocused content\n');
		await page.evaluate(() => {
			(document.activeElement as HTMLElement | null)?.blur();
			window.getSelection()?.removeAllRanges();
		});
		expect(await caretRect(page)).toBeNull();
	});

	test('reveal on an out-of-range path resolves false', async ({ page }) => {
		await editor.loadContent('only block\n');
		const revealed = await page.evaluate(() => (window as any).__test.rects.reveal([99]));
		expect(revealed).toBe(false);
	});

	test('reveal mounts a windowed-out block and resolves true', async ({ page }) => {
		await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);
		const last = (await cstBlockCount(page)) - 1;

		// Precondition: the last block must be off-window, or reveal has nothing to mount.
		await expect(page.locator(`[data-block-path='${JSON.stringify([last])}']`)).toHaveCount(0);

		const revealed = await page.evaluate((i) => (window as any).__test.rects.reveal([i]), last);
		expect(revealed).toBe(true);
		await expect(page.locator(`[data-block-path='${JSON.stringify([last])}']`)).toHaveCount(1);
	});
});
