import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { progressiveScrollTo, spacerCount, UNWINDOWED_PROSE } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Two things writing one scrollTop, made to collide. Scrolling to a block re-asserts an exact
// position that already includes the header's current height, while the header's resize
// observer adds a difference on top. A resize that lands mid-scroll therefore applies that
// difference twice. Windowed deep enough that the scroll really runs its mount-and-settle loop.
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

	// The collision in one tick: the scroll starts settling and the header's height changes
	// before it finishes.
	const landed = await page.evaluate((target) => {
		const settled = (window as any).__test.rects.scrollTo([target]) as Promise<boolean>;
		(document.querySelector('[data-testid="header-height-toggle"]') as HTMLElement).click();
		return settled;
	}, TARGET);
	expect(landed).toBe(true);
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();

	// Proves something: the header really did grow, so a pass below is about the collision.
	expect(
		await page
			.locator('[data-testid="harness-header"]')
			.evaluate((el) => el.getBoundingClientRect().height)
	).toBeCloseTo(240, 0);

	// `'nearest'` puts the target at the top, so applying the difference twice leaves it a
	// whole HEADER_DELTA above that, off screen entirely.
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

	// The cases above measure where the target came to rest, and a wrong write that something
	// else then corrects still rests correctly. This one watches every write to scrollTop, so a
	// wrong one that is corrected afterwards still fails.
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

	// Proves something on both counts: the scroll really did place the target, and the header
	// really did resize while it was there.
	expect(observed.landed).toBe(true);
	expect(observed.placed).toBe(true);
	expect(observed.grewBy).toBeCloseTo(HEADER_DELTA, 0);
	// Before only one of them was allowed to write, this held one entry: the observer's
	// difference written on top of an exact position that already included the new height.
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

	// A `'nearest'` scroll keeps holding its position after it lands, which is what search
	// navigation relies on, so both writers are still live long after the loop has finished.
	expect(await page.evaluate((t) => (window as any).__test.rects.scrollTo([t]), TARGET)).toBe(true);
	await editor.waitForRenderFlush();
	const beforeTop = await page.evaluate((t) => {
		const rect = (window as any).__test.rects.blockRect([t]) as DOMRect;
		return rect.top - document.querySelector('.editor')!.getBoundingClientRect().top;
	}, TARGET);

	await page.locator('[data-testid="header-height-toggle"]').click();
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();

	// The held position is what holds here: the target keeps its place across the resize rather
	// than being pushed by a difference its own write already included.
	const afterTop = await page.evaluate((t) => {
		const rect = (window as any).__test.rects.blockRect([t]) as DOMRect;
		return rect.top - document.querySelector('.editor')!.getBoundingClientRect().top;
	}, TARGET);
	expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(2);
	expect(pageErrors).toEqual([]);
});

// ── The other side of the rule ──────────────────────────────────────────

// Leaving it to the scroll is right only where the scroll really is holding the position. A
// `'nearest'` scroll to a block already on screen moves nothing, so a writer that steps back by
// placing it again turns a header resize into a scroll nobody asked for. Below the windowing
// threshold on purpose: a windowed document re-asserts on every measure pass and the difference
// would be invisible.

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

	// Proves something: windowing really is off, and the target really is already on screen, so
	// the scroll below moves nothing and the held position is on a block mid-viewport.
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

	// The correction still handles this one. Stepping back and placing the block again instead
	// dragged it to the top, hundreds of pixels of scroll nobody asked for.
	expect(Math.abs((await offsetInPort(visibleTarget)) - beforeReveal)).toBeLessThanOrEqual(2);
	expect(pageErrors).toEqual([]);
});
