import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { progressiveScrollTo, spacerCount, UNWINDOWED_PROSE } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Two writers of one scrollTop, colliding on purpose. The reveal anchor re-asserts an
// ABSOLUTE position that already includes the header's current height; the header slot's
// resize observer adds a RELATIVE delta. A resize landing mid-reveal therefore applies the
// delta twice. Windowed deep enough that the reveal runs its mount-and-settle loop for real.
const WINDOWED_BYTES = 500_000;
const HEADER_DELTA = 160;
const TARGET = 40;

test('a header resize landing inside a reveal does not double-apply its delta', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto('?header=on');
	await editor.loadLargeFixture('many-small-blocks', WINDOWED_BYTES);
	await progressiveScrollTo(editor, 4000);
	await editor.waitForRenderFlush();

	// The collision, in one tick: the reveal claims and starts settling, and the slot's
	// height changes before it converges.
	const landed = await page.evaluate((target) => {
		const settled = (window as any).__test.rects.scrollTo([target]) as Promise<boolean>;
		(document.querySelector('[data-testid="header-height-toggle"]') as HTMLElement).click();
		return settled;
	}, TARGET);
	expect(landed).toBe(true);
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();

	// Vacuity: the header really did grow, so a green below is about the collision.
	expect(
		await page
			.locator('[data-testid="harness-header"]')
			.evaluate((el) => el.getBoundingClientRect().height)
	).toBeCloseTo(240, 0);

	// `'nearest'` top-pins, so a double-applied delta parks the target a full HEADER_DELTA
	// above the scrollport top — off the port entirely.
	const seen = await page.evaluate((target) => {
		const rect = (window as any).__test.rects.blockRect([target]) as DOMRect;
		const port = document.querySelector('.editor')!.getBoundingClientRect();
		return { top: rect.top, bottom: rect.bottom, portTop: port.top, portBottom: port.bottom };
	}, TARGET);
	expect(seen.top - seen.portTop).toBeGreaterThan(-HEADER_DELTA / 2);
	expect(seen.top).toBeLessThan(seen.portBottom);
	expect(seen.bottom).toBeGreaterThan(seen.portTop);
	expect(pageErrors).toEqual([]);
});

test('no write unplaces the target once the reveal has placed it', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto('?header=on');
	await editor.loadLargeFixture('many-small-blocks', WINDOWED_BYTES);
	await progressiveScrollTo(editor, 4000);
	await editor.waitForRenderFlush();

	// The landing arms above measure where the target came to REST, and a wrong write that
	// something else corrects rests correctly. This one watches every scrollTop write, so a
	// corrected-after-the-fact unplacement still fails.
	const observed = await page.evaluate(
		async ({ target, delta }) => {
			const root = document.querySelector('.editor') as HTMLElement;
			const header = document.querySelector('[data-testid="harness-header"]') as HTMLElement;
			const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
			const offsetFromPin = (): number | null => {
				const rect = (window as any).__test.rects.blockRect([target]) as DOMRect | null;
				return rect ? rect.top - root.getBoundingClientRect().top : null;
			};

			let placed = false;
			const unplaced: Array<{ wrote: number; offBy: number }> = [];
			Object.defineProperty(root, 'scrollTop', {
				configurable: true,
				get() {
					return scrollTop.get!.call(this);
				},
				set(v: number) {
					scrollTop.set!.call(this, v);
					const off = offsetFromPin();
					if (off === null) return;
					if (!placed) placed = Math.abs(off) <= 1;
					else if (Math.abs(off) > 1)
						unplaced.push({ wrote: Math.round(v), offBy: Math.round(off) });
				}
			});

			const settled = (window as any).__test.rects.scrollTo([target]) as Promise<boolean>;
			(document.querySelector('[data-testid="header-height-toggle"]') as HTMLElement).click();
			const landed = await settled;
			await new Promise((r) => setTimeout(r, 500));
			return {
				landed,
				placed,
				unplaced,
				grewBy: header.getBoundingClientRect().height - delta
			};
		},
		{ target: TARGET, delta: 240 - HEADER_DELTA }
	);

	// Vacuity, both halves: the reveal really did place the target, and the header
	// really did resize while it was placed.
	expect(observed.landed).toBe(true);
	expect(observed.placed).toBe(true);
	expect(observed.grewBy).toBeCloseTo(HEADER_DELTA, 0);
	// Before the one-writer rule this held one entry: the observer's relative delta written
	// on top of an absolute position that already included the new header height.
	expect(observed.unplaced).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test('a header resize while a landed reveal still holds its pin does not double-apply', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto('?header=on');
	await editor.loadLargeFixture('many-small-blocks', WINDOWED_BYTES);
	await progressiveScrollTo(editor, 4000);
	await editor.waitForRenderFlush();

	// A `'nearest'` reveal holds its claim after it lands (durable visibility is what search
	// navigation rides), so the two writers stay live long after the settle loop is gone.
	expect(await page.evaluate((t) => (window as any).__test.rects.scrollTo([t]), TARGET)).toBe(true);
	await editor.waitForRenderFlush();
	const beforeTop = await page.evaluate((t) => {
		const rect = (window as any).__test.rects.blockRect([t]) as DOMRect;
		return rect.top - document.querySelector('.editor')!.getBoundingClientRect().top;
	}, TARGET);

	await page.locator('[data-testid="header-height-toggle"]').click();
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();

	// The pin is what holds here: the target keeps its place in the scrollport across
	// the resize, rather than being pushed by a delta the pin's own write already had.
	const afterTop = await page.evaluate((t) => {
		const rect = (window as any).__test.rects.blockRect([t]) as DOMRect;
		return rect.top - document.querySelector('.editor')!.getBoundingClientRect().top;
	}, TARGET);
	expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(2);
	expect(pageErrors).toEqual([]);
});

// ── The other side of the rule ──────────────────────────────────────────

// Deferring to the anchor is only right where the anchor actually holds the position. A
// `'nearest'` reveal of an ALREADY-VISIBLE block scrolls nothing, so a writer that defers by
// RE-PLACING turns a header resize into a scroll the reader never asked for.
// Under the watermark on purpose: a windowed document re-asserts on every measure pass and
// the distinction would be invisible.

test('a header resize compensates rather than re-places a reveal the anchor is not holding', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto('?header=on');
	await editor.loadContent(`${UNWINDOWED_PROSE}\n`);
	await editor.scrollEditorTo(300);
	await editor.waitForRenderFlush();

	const offsetInPort = (index: number) =>
		page.evaluate((i) => {
			const rect = (window as any).__test.rects.blockRect([i]) as DOMRect;
			return rect.top - document.querySelector('.editor')!.getBoundingClientRect().top;
		}, index);

	// Vacuity: windowing really is inactive, and the target really is on screen already
	// (so the reveal below moves nothing and the claim rides a mid-viewport block).
	expect(await spacerCount(page)).toBe(0);
	const visibleTarget = 14;
	const beforeReveal = await offsetInPort(visibleTarget);
	expect(beforeReveal).toBeGreaterThan(100);

	expect(
		await page.evaluate((i) => (window as any).__test.rects.scrollTo([i]), visibleTarget)
	).toBe(true);
	await editor.waitForRenderFlush();
	expect(Math.abs((await offsetInPort(visibleTarget)) - beforeReveal)).toBeLessThanOrEqual(1);

	await page.locator('[data-testid="header-height-toggle"]').click();
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();

	// Compensation still owns this one. A deferral that re-places instead dragged the block
	// to the top of the scrollport — hundreds of px of scroll nothing requested.
	expect(Math.abs((await offsetInPort(visibleTarget)) - beforeReveal)).toBeLessThanOrEqual(2);
	expect(pageErrors).toEqual([]);
});
