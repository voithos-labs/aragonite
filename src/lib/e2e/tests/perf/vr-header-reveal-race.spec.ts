import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { progressiveScrollTo } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Two writers of one scrollTop, colliding on purpose. The reveal anchor re-asserts an
// ABSOLUTE position derived from the list's live offset within the scroll content — a
// measure that already includes the header's current height. The header slot's resize
// observer adds a RELATIVE delta. A header height change landing while a reveal is in
// flight therefore adds the delta on top of a position that already accounts for it,
// and the revealed block lands off by that much.
//
// Fixture: `/test/editor?header=on` (80px <-> 240px), windowed deep enough that the
// reveal runs its mount-and-settle loop for real.
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

	// `'nearest'` top-pins, so the target's top sits at the scrollport's top. A
	// double-applied header delta parks it a full HEADER_DELTA above that — off the top
	// of the port, which is also what the honest `landed` boolean would have to deny.
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

	// The landing arms above measure where the target came to REST, and a wrong write
	// that something else corrects rests correctly. This one watches every scrollTop
	// write: once one has put the target where the reveal asked, no later write may
	// take it away again. Whether a corrector follows is not the contract — it is a
	// side effect of the very write that broke the placement, and it runs only when
	// the resulting slide happens to mount a block.
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
	// Before the one-writer rule, the header observer added its relative delta on top
	// of an absolute position that already included the new header height:
	// [{ wrote: 1632, offBy: -160 }], against an anchor that had just written 1472.
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

	// A `'nearest'` reveal holds its claim after it lands (durable visibility is the
	// contract search navigation rides), so the two writers stay live together long
	// after the settle loop is gone — the header can resize at any point until the
	// reader's next gesture releases the pin.
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

// Deferring to the anchor is only right where the anchor is actually holding the
// position. A `'nearest'` reveal of an ALREADY-VISIBLE block is a no-op — the block
// was in view, so nothing scrolled — yet the claim is held over a target sitting
// mid-viewport. The anchor's placement for it is the top pin, so a writer that defers
// by RE-PLACING turns a header resize into a scroll the reader never asked for.
//
// Under the watermark on purpose: a windowed document re-asserts on every measure pass,
// so the target is already at the pin whenever the header resizes and the distinction is
// invisible. With windowing inactive nothing re-asserts, and the header resize would be
// the only re-placement trigger there is.
const UNWINDOWED_PROSE = Array.from(
	{ length: 60 },
	(_, i) => `Paragraph ${i} of the header fixture.`
).join('\n\n');

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
	expect(await page.evaluate(() => document.querySelectorAll('.vr-spacer').length)).toBe(0);
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

	// The header compensation still owns this one: the reader keeps their place. A
	// deferral that re-places instead of asking dragged the block to the top of the
	// scrollport, ~263px of scroll nothing requested.
	expect(Math.abs((await offsetInPort(visibleTarget)) - beforeReveal)).toBeLessThanOrEqual(2);
	expect(pageErrors).toEqual([]);
});
