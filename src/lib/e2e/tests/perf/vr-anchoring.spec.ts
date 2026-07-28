import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	FIXTURE_BYTES,
	cstBlockCount,
	spacerCount,
	editorScrollHeight,
	topVisibleHostTop,
	progressiveScrollTo
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Scroll-anchor stability: a deep jump, a viewport resize, an above-fold insert, a
// column pin, or a below-fold reorder must hold the viewport (no vanish, no
// teleport, no scrollTop drift) as off-window heights measure in. The editor owns
// anchor correction (native overflow-anchor is disabled), per scope.

// Build a doc the per-kind estimator badly UNDER-models: tall paragraphs (many
// hard `<br>` line breaks → ~30 rendered lines from short raw, so the char-based
// estimate counts ~1 line) interleaved with short single-line paragraphs. The
// estimate-seeded model therefore runs far shorter than the real layout, so a deep
// scroll lands in an UNMEASURED band where the overscan blocks above the viewport
// top measure in ~30× taller than estimate — the exact VR-2 jump condition.
const NON_UNIFORM_BLOCKS = 1200;
function buildNonUniformDoc(): string {
	return (
		Array.from({ length: NON_UNIFORM_BLOCKS }, (_, i) =>
			i % 4 === 0 ? `line${'<br>line'.repeat(30)}` : `short ${i}`
		).join('\n\n') + '\n'
	);
}

// Width-SENSITIVE doc for the resize test: long single-line paragraphs (~60 words) that
// wrap to more lines as the content column narrows, so a width change really does change
// every block's real height (unlike the `<br>` fixture, whose hard breaks are
// width-independent). ~900 such paragraphs clear the activation watermark.
const WIDE_PROSE_BLOCKS = 900;
function buildWideProseDoc(): string {
	const line = Array.from({ length: 60 }, (_, w) => `word${w % 16}`).join(' ');
	return Array.from({ length: WIDE_PROSE_BLOCKS }, () => line).join('\n\n') + '\n';
}

// The nested analog of buildNonUniformDoc: ONE blockquote whose children the per-kind
// estimator badly UNDER-models, so a deep jump lands in an unmeasured nested band. Every
// child is a tall `<br>`-heavy quoted paragraph (~30 rendered lines from short raw → the
// char-based estimate counts ~1 line), kept inside a single `blockquote` node by the bare
// `>` lazy-continuation line between paragraphs (the same join the giant-blockquote fixture
// uses). The `<br>`s sit on ONE physical line, so each paragraph is one `> …` line that
// round-trips byte-identically through `loadContent`'s exact-equality poll. Blockquote (not
// list) on purpose: its paragraph children are BlockHosts that enroll in the scope's batched
// measure pass — the `correctAnchor`-wrapped `flushMeasurements` — so this exercises the
// nested scope's anchor correction. List items report via the deliberately-uncorrected
// `setChildSubtotal` channel (the documented VR-2 cross-scope limitation), which would make
// a list-based jump vacuous for the same reason the uniform fixtures are.
const NESTED_NON_UNIFORM_CHILDREN = 1000;
function buildNonUniformBlockquoteDoc(): string {
	const tall = `line${'<br>line'.repeat(30)}`;
	return (
		Array.from({ length: NESTED_NON_UNIFORM_CHILDREN }, () => `> ${tall}`).join('\n>\n') + '\n'
	);
}

function scrollTopOf(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

test('scrolling to a mid offset does not make the top visible block vanish', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	const scrollHeight = await editorScrollHeight(page);
	await editor.scrollEditorTo(Math.round(scrollHeight / 2));

	// Identify the top-level block sitting at the top of the viewport and its
	// in-viewport offset.
	const topBlock = await topVisibleHostTop(page, {
		selector: '[data-block-path]:not([data-block-path*=","])'
	});
	expect(topBlock).not.toBeNull();

	await editor.waitForRenderFlush();

	// The same block must still be present and not have teleported. The asserted invariant
	// is non-disappearance, not VR-2 anchoring: the before/after block-Y delta reads flat by
	// construction (one pre-paint flush settles the band before the DOM is observable, and
	// nothing mutates between the two reads), so no tighter bound here could guard the
	// within-flush correction. That correction is guarded by the settled-scrollTop test
	// ('a deep jump ... holds the viewport via scroll-anchor correction').
	const after = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, topBlock!.ref);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topBlock!.top)).toBeLessThan(200);
	expect(pageErrors).toEqual([]);
});

test('structural edit in a windowed non-uniform list keeps the viewport stable', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: every 8th item wraps to many lines, the rest are one
	// line. A uniform fixture can't catch the bug — every slot's estimate already
	// equals its measured height, so a rebuild's reseed is a no-op. ~600 items clear
	// the 4000px activation watermark with room to spare.
	const md =
		Array.from({ length: 600 }, (_, i) => `- ${'word '.repeat(i % 8 === 0 ? 60 : 4).trim()}`).join(
			'\n'
		) + '\n';
	await editor.loadContent(md);

	expect(
		await page.evaluate(() => document.querySelectorAll('.list-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const itemCount = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// Progressive scroll 0 → middle, ~0.6 viewport per step, flushing between. This
	// MOUNTS and measures every item the window passes over — list items reach the
	// model only via setChildSubtotal, and only when mounted. A direct jump leaves
	// the above-window items at estimate in BOTH branches, so the rebuild would
	// change nothing there and the test couldn't tell Fix 1 apart. Measuring them
	// in first is what makes the rebuild's reseed observable.
	const target = Math.round((await editorScrollHeight(page)) / 2);
	await progressiveScrollTo(editor, target);
	await editor.waitForRenderFlush();

	// Reference: the topmost in-view nested CONTENT host (list items aren't
	// data-block-path; their paragraph is, at [0, k, 0]). Edit a host LOWER in the
	// viewport so the inserted sibling lands below the reference and its path stays
	// stable — re-querying the same path after an edit above it would read a
	// different item.
	const inView = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const bottom = editorEl.getBoundingClientRect().bottom;
		const hosts = Array.from(document.querySelectorAll('[data-block-path*=","]')) as HTMLElement[];
		const visible = hosts
			.map((h) => ({
				path: h.getAttribute('data-block-path')!,
				top: h.getBoundingClientRect().top
			}))
			.filter((h) => {
				const el = document.querySelector(`[data-block-path='${h.path}']`) as HTMLElement;
				const rect = el.getBoundingClientRect();
				return rect.bottom > top + 1 && rect.top < bottom;
			});
		return { reference: visible[0], editTarget: visible[Math.min(3, visible.length - 1)] };
	});
	expect(inView.reference).toBeTruthy();
	expect(inView.editTarget).toBeTruthy();

	const scrollHeightBefore = await editorScrollHeight(page);

	// Real structural edit: click into a visible item's content and press Enter at
	// its end to split off a NEW sibling item (+1 to the list's child count), which
	// triggers the ListBlock rebuild. Verify the count actually changed — a split
	// that only touched inner content wouldn't rebuild and would prove nothing.
	const editPath = JSON.parse(inView.editTarget.path) as number[];
	const editLen = await page.evaluate((p) => {
		const el = document.querySelector(`[data-block-path='${JSON.stringify(p)}']`) as HTMLElement;
		return el?.textContent?.length ?? 0;
	}, editPath);
	await editor.clickBlockAtPath(editPath, editLen);
	await page.keyboard.press('Enter');
	// Windowing mounts only a slice, so the DOM .list-item-block count isn't the
	// full item count — poll the CST list's child count instead.
	await page.waitForFunction(
		(n) => (window as any).__test.getDocument().children[0].children.length === n,
		itemCount + 1,
		{ timeout: 5000, polling: 16 }
	);
	await editor.waitForRenderFlush();

	// Primary signal: scrollHeight stability. Without Fix 1 the rebuild reseeds every
	// above-window item from estimate, collapsing the spacer-backed content height by
	// thousands of px; the single added item moves it only by one item's height.
	const scrollHeightAfter = await editorScrollHeight(page);
	expect(Math.abs(scrollHeightAfter - scrollHeightBefore)).toBeLessThan(500);

	// Corroborating signal: the reference host (above the edit) must not teleport.
	const referenceAfter = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, inView.reference.path);
	expect(referenceAfter).not.toBeNull();
	expect(Math.abs(referenceAfter! - inView.reference.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('nested: scrolling mid into a giant blockquote does not teleport the top nested block', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-blockquote', 2_000_000);

	const scrollHeight = await editorScrollHeight(page);
	await editor.scrollEditorTo(Math.round(scrollHeight / 2));

	// The NESTED host (path carries a comma) at the top of the viewport, and its
	// in-viewport offset. Inverts the top-level anchor test's :not([*=","]) filter.
	const topNested = await topVisibleHostTop(page, { selector: '[data-block-path*=","]' });
	expect(topNested).not.toBeNull();

	await editor.waitForRenderFlush();

	const after = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, topNested!.ref);
	expect(after).not.toBeNull();
	// Guards non-disappearance / non-teleport of the SETTLED top block, not VR-2
	// anchoring: a before/after block-Y delta reads flat by construction (the spacer
	// write, slice mount, and scrollTop correction all flush in one pre-paint pass, so
	// the DOM is only observable post-settle). The VR-2 within-flush correction is
	// guarded by the settled-scrollTop test below ('a deep jump ... holds the viewport
	// via scroll-anchor correction'); this bound stays at non-disappearance.
	expect(Math.abs(after! - topNested!.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('structural edit in a windowed non-uniform table keeps the viewport stable', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: every 8th body row is tall (multi-line cells via <br>),
	// the rest one line. A uniform table can't catch the bug — every slot's estimate
	// already equals its measured height, so a rebuild's reseed is a no-op. ~600 rows
	// clear the 4000px activation watermark with room to spare.
	const header = '| a | b | c |\n| --- | --- | --- |\n';
	const body =
		Array.from({ length: 600 }, (_, i) =>
			i % 8 === 0 ? `| ${'x<br>'.repeat(8)}x | y | z |` : `| p | q | r |`
		).join('\n') + '\n';
	await editor.loadContent(header + body);

	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const rowCount = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// Progressive scroll 0 -> middle, ~0.6 viewport per step, flushing between, so the
	// window passes over (mounts + measures) the tall rows. Rows reach the model only
	// via setChildSubtotal, and only when mounted; a direct jump leaves above-window
	// rows at estimate and the rebuild would change nothing there.
	const target = Math.round((await editorScrollHeight(page)) / 2);
	await progressiveScrollTo(editor, target);
	await editor.waitForRenderFlush();

	// Reference: the topmost visible row's cell (by row-idx + top — a display:contents
	// row has no box, so track a CELL). Edit a row LOWER in the viewport so the inserted
	// sibling lands below the reference and the reference's row-idx stays stable.
	const view = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const bottom = editorEl.getBoundingClientRect().bottom;
		const rows = Array.from(document.querySelectorAll('[data-table-row-idx]')) as HTMLElement[];
		const visible = rows
			.map((r) => {
				const rect = (
					r.querySelector(':scope > .table-cell') as HTMLElement | null
				)?.getBoundingClientRect();
				return {
					idx: r.getAttribute('data-table-row-idx')!,
					top: rect?.top ?? null,
					bottom: rect?.bottom ?? null
				};
			})
			.filter((r) => r.top !== null && r.bottom! > top + 1 && r.top! < bottom);
		return { reference: visible[0], editIdx: visible[Math.min(3, visible.length - 1)]?.idx };
	});
	expect(view.reference).toBeTruthy();
	expect(view.editIdx).toBeTruthy();

	const scrollHeightBefore = await editorScrollHeight(page);

	// Real structural edit: click the lower visible cell, Ctrl+Enter inserts a row
	// below it (+1 to the table's child count), triggering the TableBlock rebuild.
	// Verify the count actually changed — an edit that didn't rebuild proves nothing.
	await page.locator(`[data-table-row-idx="${view.editIdx}"] [role="cell"]`).first().click();
	await page.keyboard.press('Control+Enter');
	await page.waitForFunction(
		(n) => (window as any).__test.getDocument().children[0].children.length === n,
		rowCount + 1,
		{ timeout: 5000, polling: 16 }
	);
	await editor.waitForRenderFlush();

	// Primary signal: scrollHeight stability. Without the oracle-persisting subtotal
	// write, the rebuild reseeds every above-window row from estimate, collapsing the
	// spacer-backed content height by thousands of px; one added row moves it only by
	// one row's height.
	const scrollHeightAfter = await editorScrollHeight(page);
	expect(Math.abs(scrollHeightAfter - scrollHeightBefore)).toBeLessThan(500);

	// Corroborating signal: the reference row (above the edit) must not teleport.
	const referenceAfter = await page.evaluate((idx) => {
		const cell = document
			.querySelector(`[data-table-row-idx="${idx}"]`)
			?.querySelector(':scope > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().top : null;
	}, view.reference.idx);
	expect(referenceAfter).not.toBeNull();
	expect(Math.abs(referenceAfter! - view.reference.top!)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('scrolling mid into a giant table does not teleport the top visible row', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	const scrollHeight = await editorScrollHeight(page);
	await editor.scrollEditorTo(Math.round(scrollHeight / 2));

	// The row at the top of the viewport, tracked via a CELL's top (display:contents
	// row has no box). Identify the row by data-table-row-idx and read its first cell.
	const topRow = await topVisibleHostTop(page, {
		selector: '[data-table-row-idx]',
		attr: 'data-table-row-idx',
		cell: true
	});
	expect(topRow).not.toBeNull();

	await editor.waitForRenderFlush();

	// The same row must still be present and not have teleported. Guards non-disappearance
	// of the SETTLED top row, not VR-2 anchoring: the before/after cell-Y delta reads flat
	// by construction (one pre-paint flush settles the band before the DOM is observable),
	// and it cannot catch a static mis-measure either — nothing mutates between the two
	// reads, so the same row stays at the same settled Y. The VR-2 within-flush correction
	// is guarded by the settled-scrollTop test below.
	const after = await page.evaluate((idx) => {
		const cell = document
			.querySelector(`[data-table-row-idx="${idx}"]`)
			?.querySelector(':scope > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().top : null;
	}, topRow!.ref);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topRow!.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

// VR-2 anchor correction. With native `overflow-anchor` disabled (Editor.svelte) the
// editor OWNS scroll-anchor correction: when above-viewport blocks measure in taller
// than their estimate, the top spacer grows and would slide the visible content down by
// the accumulated error; `correctAnchor` shifts scrollTop by the model-offset delta so
// the block the user is looking at stays at the viewport top.
//
// The honest discriminator is the SETTLED scrollTop, not a within-flush block drift: a
// model write and the spacer's bound `style.height` flush in the same pre-paint pass as
// the slice mount, so by the time the DOM is observable the band has already settled and
// a block-Y delta reads flat (the probe established this). The load-bearing signal is
// that scrollTop is compensated FORWARD off the jump target by the accumulated band error
// (~thousands of px), holding the same content in view. Mutation-check (proven by
// reverting `correctAnchor`'s `scrollTop += delta`): scrollTop stays pinned at the exact
// target (compensation 0) and the content the user was looking at is displaced out of
// view — see the report's before/after numbers.
test('a deep jump into an unmeasured band holds the viewport via scroll-anchor correction (VR-2)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildNonUniformDoc());

	// Precondition: windowing is active, or there is no spacer band to jump into and the
	// test is vacuous.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	const estimateScrollHeight = await editorScrollHeight(page);

	// Jump 60% into the estimate-seeded content — a fresh, unmeasured band whose blocks
	// the estimator under-models by ~30× (the tall `<br>` paragraphs).
	const target = Math.round(estimateScrollHeight * 0.6);
	await editor.scrollEditorTo(target);
	for (let i = 0; i < 5; i++) await editor.waitForRenderFlush();

	const settled = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const bottom = editorEl.getBoundingClientRect().bottom;
		const hosts = Array.from(
			document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		let topBlockY: number | null = null;
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > top + 1) {
				topBlockY = rect.top;
				break;
			}
		}
		return { scrollTop: editorEl.scrollTop, editorTop: top, editorBottom: bottom, topBlockY };
	});

	const compensation = settled.scrollTop - target;
	console.log(
		`VR-2 anchor ${JSON.stringify({ estimateScrollHeight, target, ...settled, compensation })}`
	);

	// Load-bearing: scrollTop is compensated FORWARD by the band's measure-in error. The
	// uncorrected build pins scrollTop at exactly the target (compensation 0); the +500px
	// floor sits well above measurement jitter and far below the multi-thousand-px
	// compensation a 30×-under-modeled band produces.
	expect(compensation).toBeGreaterThan(500);

	// The viewport stayed populated through the reflow: a mounted block still sits at the
	// top edge (not a blank spacer, not scrolled past the content). Without correction the
	// content is displaced but scrollTop is unchanged, so this stays true too — it's a
	// sanity check, not the discriminator (that is `compensation` above).
	expect(settled.topBlockY).not.toBeNull();
	expect(settled.topBlockY!).toBeLessThan(settled.editorTop + 60);
	expect(pageErrors).toEqual([]);
});

// VR-1 resize / width invalidation. A width change re-wraps prose, so the heights the
// oracle measured at the old width are stale. The editor's ResizeObserver clears the
// oracle cache and bumps `widthVersion`, which rebuilds every scope's model at the new
// width AND re-enrolls the mounted blocks so the batch re-measures their real new-width
// heights. Part A's anchor correction (the rebuild reseed is wrapped in it) keeps the
// viewport stable through the reflow.
//
// Two signals. (1) Re-measure: the model's `scrollHeight` must TRACK the narrower wrap —
// a mounted block grows in the DOM and the model must follow, so `scrollHeight` grows.
// Reverting the wiring (`invalidateWidth` + the `widthVersion` re-enroll) leaves the
// model on wide heights while the DOM re-wraps taller underneath, so `scrollHeight` does
// NOT track and the bound fails. (2) Anchor: the top-of-viewport block does not teleport
// as the model reseeds.
test('narrowing the viewport re-measures wrapped heights and holds the anchor (VR-1)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildWideProseDoc());

	expect(await spacerCount(page)).toBeGreaterThan(0);

	// Scroll mid-doc so the window has mounted+measured a band at the WIDE width — the
	// blocks whose real heights change when the column narrows. (Above-window blocks sit
	// at estimate and reseed to a narrow estimate either way; the mounted band is where
	// re-measure is observable.)
	const wideScrollHeight = await editorScrollHeight(page);
	await progressiveScrollTo(editor, Math.round(wideScrollHeight / 2));

	const before = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const editorTop = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(
			document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		// The block at the viewport top (anchor) and a fully-mounted block's own height
		// (re-wrap sanity). The anchor's top is recorded RELATIVE TO THE EDITOR, not the
		// browser viewport: narrowing the window reflows the demo harness chrome above the
		// editor slot and moves the editor's own page position, which the anchor correction
		// neither causes nor controls. A viewport-absolute read folds that container shift
		// into the drift and mismeasures what the correction holds.
		let anchor: { path: string; topInEditor: number } | null = null;
		let sampleHeight: number | null = null;
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (!anchor && rect.bottom > editorTop + 1)
				anchor = {
					path: host.getAttribute('data-block-path')!,
					topInEditor: rect.top - editorTop
				};
			if (rect.top > editorTop + 1 && sampleHeight === null) sampleHeight = rect.height;
		}
		return {
			width: editorEl.clientWidth,
			scrollHeight: editorEl.scrollHeight,
			anchor,
			sampleHeight
		};
	});
	expect(before.anchor).not.toBeNull();

	// Narrow the window substantially → the content column re-wraps every paragraph to
	// more lines, firing the editor's width ResizeObserver.
	await page.setViewportSize({ width: 760, height: 900 });
	for (let i = 0; i < 5; i++) await editor.waitForRenderFlush();

	const after = await page.evaluate((anchorPath) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const editorTop = editorEl.getBoundingClientRect().top;
		const host = document.querySelector(`[data-block-path='${anchorPath}']`) as HTMLElement | null;
		return {
			width: editorEl.clientWidth,
			scrollHeight: editorEl.scrollHeight,
			anchorTopInEditor: host ? host.getBoundingClientRect().top - editorTop : null
		};
	}, before.anchor!.path);

	const drift =
		after.anchorTopInEditor !== null
			? Math.abs(after.anchorTopInEditor - before.anchor!.topInEditor)
			: Infinity;
	console.log(
		`VR-1 resize ${JSON.stringify({
			wideWidth: before.width,
			narrowWidth: after.width,
			wideScrollHeight: before.scrollHeight,
			narrowScrollHeight: after.scrollHeight,
			drift
		})}`
	);

	expect(after.width).toBeLessThan(before.width - 100); // a real width delta occurred

	// (1) Re-measure: the narrower column wraps each paragraph to more lines, so the
	// model-backed scrollHeight grows. Without the width wiring the model keeps wide
	// heights and scrollHeight barely moves; the > 10% growth bound fails on the revert.
	expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight * 1.1);

	// (2) Anchor held through the reflow: the top block does not teleport WITHIN the editor.
	// The rebuild reseed is anchor-corrected, so a sub-line bound holds even as every height
	// changes. Measured editor-relative (see `before`), the correction holds to well under a
	// line; the 20px bound is far above that residual and far below a one-block slip.
	expect(after.anchorTopInEditor).not.toBeNull();
	expect(drift).toBeLessThan(20);
	expect(pageErrors).toEqual([]);
});

// VR-2 anchor correction at a NESTED scope. `correctAnchor` is instantiated per scope
// (the editor root AND every activated nested container), and the deep-jump test above
// guards only the ROOT instance — its flat doc makes the root scope the one whose band
// measures in. This guards a nested instance with the SAME settled-scrollTop discriminator,
// driving the jump into a single giant blockquote whose children measure in far taller than
// estimate.
//
// What makes the compensation NESTED-attributable (not a duplicate of the root test, which
// reverts the same `scrollTop += delta` line): the doc has exactly ONE top-level block (the
// blockquote). The root scope's model therefore holds a single entry, so its anchor index is
// always 0 and `offsetOf(0) ≡ 0` — the root `correctAnchor` delta is structurally 0, a no-op,
// and the count-stable rebuild `$effect` never fires for it either. Any observed compensation
// can only come from the blockquote's OWN scope correcting as its paragraph children (BlockHosts
// that enroll in the scope's batched `flushMeasurements`) measure in above the viewport. Same
// revert, two tests, disjoint responsible scopes: root above, nested here.
//
// Mutation-check (reverting `correctAnchor`'s `scrollEl.scrollTop += delta`): compensation
// drops to ~0 on this nested jump — the nested band measures in, the inner top spacer grows,
// and with no correction the content slides while scrollTop stays pinned at the jump target.
test('a deep jump into a giant blockquote holds the viewport via the nested scope anchor correction (VR-2)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildNonUniformBlockquoteDoc());

	// Preconditions: ONE top-level blockquote (so the root scope can't compensate), windowed
	// from INSIDE (nested spacers present), or the nested-attribution argument is vacuous.
	expect(await cstBlockCount(page)).toBe(1);
	expect(
		await page.evaluate(() => document.querySelectorAll('.blockquote-block .vr-spacer').length)
	).toBeGreaterThan(0);

	const estimateScrollHeight = await editorScrollHeight(page);

	// Jump 60% into the estimate-seeded nested content — a fresh band whose quoted paragraphs
	// the estimator under-models by ~30× (the tall `<br>` paragraphs), the VR-2 jump condition
	// one scope down.
	const target = Math.round(estimateScrollHeight * 0.6);
	await editor.scrollEditorTo(target);
	for (let i = 0; i < 5; i++) await editor.waitForRenderFlush();

	const settled = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		// A NESTED host (comma-path) at the viewport top proves the visible content is the
		// blockquote's windowed children, not the container chrome.
		const hosts = Array.from(document.querySelectorAll('[data-block-path*=","]')) as HTMLElement[];
		let topBlockY: number | null = null;
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > top + 1) {
				topBlockY = rect.top;
				break;
			}
		}
		return { scrollTop: editorEl.scrollTop, editorTop: top, topBlockY };
	});

	const compensation = settled.scrollTop - target;
	console.log(
		`VR-2 nested anchor ${JSON.stringify({ estimateScrollHeight, target, ...settled, compensation })}`
	);

	// Load-bearing discriminator: the nested scope's `correctAnchor` shifts scrollTop FORWARD
	// off the jump target by the band's measure-in error. Reverting `scrollTop += delta` pins
	// scrollTop at exactly the target (compensation 0); the > 500px floor sits well above
	// jitter and far below the multi-thousand-px compensation a 30×-under-modeled nested band
	// produces.
	expect(compensation).toBeGreaterThan(500);

	// The viewport stayed populated through the reflow: a mounted nested block still sits at
	// the top edge. Without correction the content is displaced but scrollTop is unchanged, so
	// this stays true too — a sanity check, not the discriminator (that is `compensation`).
	expect(settled.topBlockY).not.toBeNull();
	expect(settled.topBlockY!).toBeLessThan(settled.editorTop + 60);
	expect(pageErrors).toEqual([]);
});

// F4: anchor remap across a structural count-change rebuild. Inserting a block ABOVE the fold
// shifts every index below it, so the rebuild effect's old numeric `correctAnchor` measured a
// DIFFERENT block's offset at the anchor's now-stale index and over-corrected by ~one
// inserted-block height — the top-of-viewport block teleported (reachable via undo/redo of an
// edit above the current scroll position). The fix remaps the anchor by stable id, so its
// screen Y holds.
//
// Driven at a NESTED scope (one giant blockquote): its windowing reads `node.childIds`, which
// the production `spliceChildren` keeps in lockstep, so a programmatic above-fold splice gives
// the new block a valid id AND fires the rebuild without moving the scroll (undo would scroll
// back to the edited region — unusable here). Above-fold blocks are unmounted, so there is no
// clickable target; this is a model-reaction regression, not interaction routing. Unlike the
// deep-jump tests (where block-Y "reads flat by construction" because nothing mutates between
// reads), this DOES mutate the child set, so a wrong correction genuinely moves the anchor —
// block-Y IS the discriminator. Mutation-check: reverting the id-remap fails the held-Y bound.
test('inserting a block above the fold holds the viewport via anchor remap (F4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: a uniform doc can't catch the bug — inserting a block of the same
	// height as index N's old occupant makes the numeric delta accidentally correct. The tall
	// quoted children make the off-by-one anchor-block-height error large and observable. ONE
	// top-level blockquote, windowed from inside.
	await editor.loadContent(buildNonUniformBlockquoteDoc());
	expect(await cstBlockCount(page)).toBe(1);
	expect(
		await page.evaluate(() => document.querySelectorAll('.blockquote-block .vr-spacer').length)
	).toBeGreaterThan(0);

	// Scroll mid-doc, measuring the band the window passes over so the model holds real
	// (measured) heights around the anchor — the rebuild's reseed is only observable where
	// measured heights diverge from the reseed estimate.
	const scrollHeight = await editorScrollHeight(page);
	const target = Math.round(scrollHeight / 2);
	await progressiveScrollTo(editor, target);
	await editor.waitForRenderFlush();

	// The nested host at the top of the viewport (the anchor): its child index within the
	// blockquote and its screen Y. The insert lands at child 0, well above it.
	const topHost = await topVisibleHostTop(page, { selector: '[data-block-path*=","]' });
	expect(topHost).not.toBeNull();
	const before = {
		childIndex: (JSON.parse(topHost!.ref!) as number[])[1],
		y: topHost!.top
	};
	expect(before.childIndex).toBeGreaterThan(5); // the insert is far above the fold

	const childCountBefore = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// Splice a tall quoted paragraph in at child 0 — well above the viewport, into the unmounted
	// region. Fires the blockquote scope's windowing rebuild (ids kept in lockstep) without
	// moving the scroll.
	await page.evaluate(() => {
		const tall = `> inserted${'<br>line'.repeat(30)}\n`;
		(window as any).__test.spliceContainerChildren([0], 0, 0, tall);
	});
	expect(
		await page.evaluate(() => (window as any).__test.getDocument().children[0].children.length)
	).toBe(childCountBefore + 1);
	await editor.waitForRenderFlush();

	// The anchor child (now at childIndex+1 after the above-fold insert) must stay at the same
	// screen Y. Without the id-remap the numeric correction over-shoots and it jumps by ~one
	// inserted-block height.
	const after = await page.evaluate((childIndex) => {
		const host = document.querySelector(
			`[data-block-path='${JSON.stringify([0, childIndex])}']`
		) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, before.childIndex + 1);

	const drift = after !== null ? Math.abs(after - before.y) : Infinity;
	console.log(`F4 anchor-remap ${JSON.stringify({ ...before, after, drift })}`);

	expect(after).not.toBeNull();
	// The tall inserted block is hundreds of px; the buggy correction displaces the anchor by
	// roughly that, the fix holds it within sub-line jitter. 40px sits below the block height
	// and above measurement noise.
	expect(drift).toBeLessThan(40);
	expect(pageErrors).toEqual([]);
});

// F6: column-width stability under row windowing. `minmax(80px, max-content)` sizes a track
// to its currently-MOUNTED cells, so a column with one very wide cell near the top SHRINKS
// once that cell scrolls out of the mounted window — every row reflows mid-scroll. The fix
// pins each track to the widest cell seen across all windowed-in rows (monotonic-grow floor),
// so the column can't shrink when its widest cell unmounts. Mutation-check: reverting the
// pin lets column 0 collapse to the narrow rows' width after the scroll, failing the bound.
test('a column does not shrink when its widest cell scrolls out of the window (F6)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// One tall table. Row 0 (body) has a VERY wide first cell; the rest are narrow. Enough
	// rows to window so the wide row unmounts on a deep scroll. Column 0's max-content is
	// driven entirely by that one wide cell.
	const wide = 'wordwordword '.repeat(20).trim();
	const header = '| a | b | c |\n| --- | --- | --- |\n';
	const wideRow = `| ${wide} | y | z |\n`;
	const body = Array.from({ length: 800 }, () => `| p | q | r |`).join('\n') + '\n';
	await editor.loadContent(header + wideRow + body);

	// Precondition: the table windows its rows AND the wide row (row-idx 1, after the header
	// row 0) is mounted at load so column 0 starts at the wide width.
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);

	// Column 0's track width at load, read from a mounted row's first cell (the track width is
	// shared, so any mounted row reports it). The wide row is in the initial window.
	const widthBefore = await page.evaluate(() => {
		const cell = document.querySelector('[data-table-row-idx] > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().width : null;
	});
	expect(widthBefore).not.toBeNull();
	// Sanity: the wide cell really did stretch column 0 well past the 80px floor.
	expect(widthBefore!).toBeGreaterThan(200);

	// Scroll deep so the wide row (near the top) unmounts and only narrow rows remain mounted.
	const scrollHeight = await editorScrollHeight(page);
	await editor.scrollEditorTo(Math.round(scrollHeight * 0.9));
	await editor.waitForRenderFlush();

	// Precondition: the wide row genuinely unmounted (else the test is vacuous — the column
	// would stay wide simply because the wide cell is still in the DOM).
	expect(await page.evaluate(() => document.querySelector('[data-table-row-idx="1"]'))).toBeNull();

	// Column 0's track width now, from a currently-mounted (narrow) row's first cell.
	const widthAfter = await page.evaluate(() => {
		const cell = document.querySelector('[data-table-row-idx] > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().width : null;
	});
	console.log(`F6 column-stability ${JSON.stringify({ widthBefore, widthAfter })}`);

	expect(widthAfter).not.toBeNull();
	// The track must NOT have collapsed to the narrow rows' width. Without the pin it shrinks
	// toward the 80px floor; the fix holds it at (near) the wide width. A 0.9x bound tolerates
	// sub-pixel jitter while failing hard on the multi-hundred-px collapse the bug produces.
	expect(widthAfter!).toBeGreaterThan(widthBefore! * 0.9);
	expect(pageErrors).toEqual([]);
});

// F7: reordering a list item that is BELOW the viewport top must not drift the
// scroll. The list scope's structural anchor correction (correctAnchorByStableId)
// runs on the reorder's model rebuild; when the scope has no content scrolled
// above the viewport top (localScrollTop === 0) it would FOLLOW the relocated
// anchor block and shift the shared scrollTop. One Alt+Up + Alt+Down is a no-op,
// so scrollTop must return to baseline. Different item heights make the buggy
// per-press shift asymmetric (≈+135px/cycle pre-fix).
test('reordering a list item below the fold does not drift scrollTop (F7)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Filler above AND below so the list sits mid-document with room to drift either
	// way (not clamped at a scroll boundary). ALPHA is deliberately tall (wraps over
	// several lines), BETA short — so the anchor-follow delta is non-zero/asymmetric.
	const pre = Array.from({ length: 60 }, (_, i) => `pre filler ${i}`).join('\n\n');
	const post = Array.from({ length: 60 }, (_, i) => `post filler ${i}`).join('\n\n');
	const tall = `ZALPHAITEM ${'word '.repeat(40)}`.trim();
	const list = `1. ${tall}\n2. ZBETAITEM\n`;
	await editor.loadContent(`${pre}\n\n${list}\n${post}\n`);

	// Content offset of the first mounted host containing `text`, or null if not mounted.
	const offsetOf = (text: string) =>
		page.evaluate((t) => {
			const ed = document.querySelector('.editor') as HTMLElement;
			const host = [...document.querySelectorAll('[data-block-path]')].find((h) =>
				(h.textContent || '').includes(t)
			);
			if (!host) return null;
			return host.getBoundingClientRect().top - ed.getBoundingClientRect().top + ed.scrollTop;
		}, text);

	// Scroll until the list mounts (it may window out at first), then position its
	// top ~250px below the editor's viewport top, so the list scope's
	// localScrollTop is 0 — the condition that triggered the bug.
	let alphaOffset: number | null = null;
	for (let step = 0; step < 80 && alphaOffset === null; step++) {
		alphaOffset = await offsetOf('ZALPHAITEM');
		if (alphaOffset === null) {
			const top = await page.evaluate(() => {
				const ed = document.querySelector('.editor') as HTMLElement;
				return ed.scrollTop + ed.clientHeight * 0.7;
			});
			await editor.scrollEditorTo(top);
		}
	}
	expect(alphaOffset).not.toBeNull();
	await editor.scrollEditorTo(Math.round(alphaOffset! - 250));

	// Caret in the SECOND (BETA) item, then take the baseline AFTER the click so any
	// click-induced scroll is absorbed into the baseline.
	await page.locator('[contenteditable="true"]', { hasText: 'ZBETAITEM' }).click();
	await editor.waitForRenderFlush();

	// The alpha host's top relative to the editor's viewport top = contentOffset − scrollTop.
	const listTopRel = (await offsetOf('ZALPHAITEM'))! - (await scrollTopOf(page));
	// Precondition: the list's top is below the viewport top — i.e. localScrollTop===0
	// for the list scope. Without this the test can't reach the buggy branch.
	expect(listTopRel, 'list must sit below the viewport top (localScrollTop===0)').toBeGreaterThan(
		50
	);

	const baseline = await scrollTopOf(page);

	// Alt+Up moves BETA to index 0; the ordered markers renumber, so order is observable
	// through the serialized source.
	await page.keyboard.press('Alt+ArrowUp');
	await editor.bridge.waitForSourceMatches(/ZBETAITEM[\s\S]*ZALPHAITEM/);

	// Alt+Down moves it back — structurally identical to the start.
	await page.keyboard.press('Alt+ArrowDown');
	await editor.bridge.waitForSourceMatches(/ZALPHAITEM[\s\S]*ZBETAITEM/);
	await editor.waitForRenderFlush();

	const after = await scrollTopOf(page);
	expect(
		Math.abs(after - baseline),
		`scrollTop drifted ${after - baseline}px over one no-op reorder cycle`
	).toBeLessThan(3);
	expect(pageErrors).toEqual([]);
});
