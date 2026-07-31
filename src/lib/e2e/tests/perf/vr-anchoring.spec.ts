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

// Tall `<br>`-heavy paragraphs the char-based estimator under-models ~30×, interleaved
// with short ones: a deep scroll then lands in an unmeasured band — the VR-2 jump condition.
const NON_UNIFORM_BLOCKS = 1200;
function buildNonUniformDoc(): string {
	return (
		Array.from({ length: NON_UNIFORM_BLOCKS }, (_, i) =>
			i % 4 === 0 ? `line${'<br>line'.repeat(30)}` : `short ${i}`
		).join('\n\n') + '\n'
	);
}

// Width-SENSITIVE doc for the resize test: prose that re-wraps as the column narrows, so a
// width change really moves every height (the `<br>` fixture's hard breaks would not).
const WIDE_PROSE_BLOCKS = 900;
function buildWideProseDoc(): string {
	const line = Array.from({ length: 60 }, (_, w) => `word${w % 16}`).join(' ');
	return Array.from({ length: WIDE_PROSE_BLOCKS }, () => line).join('\n\n') + '\n';
}

// The nested analog of buildNonUniformDoc. Blockquote, not list: its paragraph children are
// BlockHosts enrolled in the scope's `correctAnchor`-wrapped measure pass, whereas list items
// report via the deliberately-uncorrected `setChildSubtotal` channel (the VR-2 cross-scope
// limitation), which would make a list-based jump vacuous.
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

	const topBlock = await topVisibleHostTop(page, {
		selector: '[data-block-path]:not([data-block-path*=","])'
	});
	expect(topBlock).not.toBeNull();

	await editor.waitForRenderFlush();

	// Non-disappearance, not VR-2 anchoring: block-Y reads flat by construction here (one
	// pre-paint flush settles the band before the DOM is observable). Do not tighten — the
	// within-flush correction is guarded by the VR-2 deep-jump test below.
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

	// Non-uniform on purpose: in a uniform fixture every slot's estimate already equals its
	// measured height, so a rebuild's reseed is a no-op and the bug is unreachable.
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

	// Progressive, not a direct jump: list items reach the model only via setChildSubtotal
	// and only while mounted, so measuring them in first is what makes the reseed observable.
	const target = Math.round((await editorScrollHeight(page)) / 2);
	await progressiveScrollTo(editor, target);
	await editor.waitForRenderFlush();

	// Edit a host LOWER in the viewport than the reference, so the inserted sibling lands
	// below it and the reference's path stays valid across the edit.
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

	// Enter at end splits off a new sibling item, which is what triggers the ListBlock
	// rebuild; the child-count poll below proves the rebuild really happened.
	const editPath = JSON.parse(inView.editTarget.path) as number[];
	const editLen = await page.evaluate((p) => {
		const el = document.querySelector(`[data-block-path='${JSON.stringify(p)}']`) as HTMLElement;
		return el?.textContent?.length ?? 0;
	}, editPath);
	await editor.clickBlockAtPath(editPath, editLen);
	await page.keyboard.press('Enter');
	// Windowing mounts only a slice, so the DOM item count is not the full one — poll the CST.
	await page.waitForFunction(
		(n) => (window as any).__test.getDocument().children[0].children.length === n,
		itemCount + 1,
		{ timeout: 5000, polling: 16 }
	);
	await editor.waitForRenderFlush();

	// Primary signal: an unfixed rebuild reseeds every above-window item from estimate and
	// collapses the spacer-backed height by thousands of px; one added item moves it by one.
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

	// A comma in the path means a NESTED host — inverts the top-level anchor test's filter.
	const topNested = await topVisibleHostTop(page, { selector: '[data-block-path*=","]' });
	expect(topNested).not.toBeNull();

	await editor.waitForRenderFlush();

	const after = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, topNested!.ref);
	expect(after).not.toBeNull();
	// Non-disappearance of the SETTLED top block: spacer write, slice mount and scrollTop
	// correction share one pre-paint pass, so block-Y reads flat here. Do not tighten — the
	// within-flush correction is guarded by the VR-2 deep-jump test below.
	expect(Math.abs(after! - topNested!.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('structural edit in a windowed non-uniform table keeps the viewport stable', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: in a uniform table every slot's estimate already equals its
	// measured height, so a rebuild's reseed is a no-op and the bug is unreachable.
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

	// Progressive, not a direct jump: rows reach the model only via setChildSubtotal and
	// only while mounted, so measuring them in first is what makes the reseed observable.
	const target = Math.round((await editorScrollHeight(page)) / 2);
	await progressiveScrollTo(editor, target);
	await editor.waitForRenderFlush();

	// Track a CELL: a display:contents row has no box. Edit a row LOWER in the viewport so
	// the inserted sibling lands below the reference and its row-idx stays valid.
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

	// Ctrl+Enter inserts a row, which is what triggers the TableBlock rebuild; the
	// child-count poll below proves the rebuild really happened.
	await page.locator(`[data-table-row-idx="${view.editIdx}"] [role="cell"]`).first().click();
	await page.keyboard.press('Control+Enter');
	await page.waitForFunction(
		(n) => (window as any).__test.getDocument().children[0].children.length === n,
		rowCount + 1,
		{ timeout: 5000, polling: 16 }
	);
	await editor.waitForRenderFlush();

	// Primary signal: without the oracle-persisting subtotal write the rebuild reseeds every
	// above-window row from estimate, collapsing the height by thousands of px.
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

	// Tracked via a CELL's top: a display:contents row has no box of its own.
	const topRow = await topVisibleHostTop(page, {
		selector: '[data-table-row-idx]',
		attr: 'data-table-row-idx',
		cell: true
	});
	expect(topRow).not.toBeNull();

	await editor.waitForRenderFlush();

	// Non-disappearance of the SETTLED top row: cell-Y reads flat by construction (one
	// pre-paint flush, nothing mutating between the two reads). Do not tighten — the
	// within-flush correction is guarded by the VR-2 deep-jump test below.
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

// VR-2 root-scope anchor correction. The discriminator is the SETTLED scrollTop, not a
// within-flush block drift: model write, spacer height and slice mount share one pre-paint
// pass, so block-Y reads flat by the time the DOM is observable. Reverting `correctAnchor`'s
// `scrollTop += delta` pins scrollTop at the exact target (compensation 0).
test('a deep jump into an unmeasured band holds the viewport via scroll-anchor correction (VR-2)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildNonUniformDoc());

	// Without windowing there is no spacer band to jump into and the test is vacuous.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	const estimateScrollHeight = await editorScrollHeight(page);

	// 60% lands in a fresh band the estimator under-models by ~30×.
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

	// The floor sits well above jitter and far below the multi-thousand-px compensation a
	// 30×-under-modeled band produces; the uncorrected build reads exactly 0.
	expect(compensation).toBeGreaterThan(500);

	// Sanity, not the discriminator: without correction the content is displaced while
	// scrollTop is unchanged, so a mounted block still sits at the top edge either way.
	expect(settled.topBlockY).not.toBeNull();
	expect(settled.topBlockY!).toBeLessThan(settled.editorTop + 60);
	expect(pageErrors).toEqual([]);
});

// VR-1 resize / width invalidation. Two signals: the model's scrollHeight must TRACK the
// narrower wrap, and the top-of-viewport block must not teleport as the model reseeds.
// Reverting the wiring (`invalidateWidth` + the `widthVersion` re-enroll) leaves the model
// on wide heights while the DOM re-wraps taller underneath, failing the first bound.
test('narrowing the viewport re-measures wrapped heights and holds the anchor (VR-1)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildWideProseDoc());

	expect(await spacerCount(page)).toBeGreaterThan(0);

	// Above-window blocks reseed estimate-to-estimate either way; only the band measured at
	// the WIDE width makes re-measure observable.
	const wideScrollHeight = await editorScrollHeight(page);
	await progressiveScrollTo(editor, Math.round(wideScrollHeight / 2));

	const before = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const editorTop = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(
			document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		// Recorded relative to the EDITOR, not the browser viewport: narrowing reflows the
		// harness chrome above the editor slot, a shift the anchor correction does not own.
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

	// Narrow enough to re-wrap every paragraph, firing the editor's width ResizeObserver.
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

	expect(after.width).toBeLessThan(before.width - 100);

	// (1) Re-measure: without the width wiring the model keeps wide heights and scrollHeight
	// barely moves, so the 10% growth bound fails on the revert.
	expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight * 1.1);

	// (2) Anchor: the corrected reseed holds to well under a line, so 20px sits far above the
	// residual and far below a one-block slip.
	expect(after.anchorTopInEditor).not.toBeNull();
	expect(drift).toBeLessThan(20);
	expect(pageErrors).toEqual([]);
});

// VR-2 anchor correction at a NESTED scope — same revert as the root test above, disjoint
// responsible scope. What makes the compensation nested-attributable: the doc has exactly ONE
// top-level block, so the root scope's anchor index is always 0 and `offsetOf(0) ≡ 0` makes
// its correction structurally a no-op. Any compensation observed can only be the blockquote's.
test('a deep jump into a giant blockquote holds the viewport via the nested scope anchor correction (VR-2)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildNonUniformBlockquoteDoc());

	// ONE top-level blockquote, windowed from INSIDE, or the nested-attribution argument
	// in the header above is vacuous.
	expect(await cstBlockCount(page)).toBe(1);
	expect(
		await page.evaluate(() => document.querySelectorAll('.blockquote-block .vr-spacer').length)
	).toBeGreaterThan(0);

	const estimateScrollHeight = await editorScrollHeight(page);

	// 60% lands in a fresh nested band the estimator under-models by ~30× — the VR-2 jump
	// condition one scope down.
	const target = Math.round(estimateScrollHeight * 0.6);
	await editor.scrollEditorTo(target);
	for (let i = 0; i < 5; i++) await editor.waitForRenderFlush();

	const settled = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		// Comma-path only: proves the visible content is the blockquote's windowed children,
		// not the container chrome.
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

	// The floor sits well above jitter and far below the multi-thousand-px compensation a
	// 30×-under-modeled nested band produces; the uncorrected build reads exactly 0.
	expect(compensation).toBeGreaterThan(500);

	// Sanity, not the discriminator: without correction the content is displaced while
	// scrollTop is unchanged, so a mounted nested block still sits at the top edge either way.
	expect(settled.topBlockY).not.toBeNull();
	expect(settled.topBlockY!).toBeLessThan(settled.editorTop + 60);
	expect(pageErrors).toEqual([]);
});

// F4: anchor remap across a structural count-change rebuild. An above-fold insert shifts every
// index below it, so a numeric anchor measures a DIFFERENT block's offset and over-corrects by
// ~one block height; the fix remaps by stable id. Block-Y IS the discriminator here (unlike the
// deep-jump tests) because the child set really mutates. Driven programmatically at a nested
// scope: above-fold blocks are unmounted, so there is no clickable target and undo would scroll.
test('inserting a block above the fold holds the viewport via anchor remap (F4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: in a uniform doc the inserted block matches index N's old
	// occupant and the numeric delta comes out accidentally correct.
	await editor.loadContent(buildNonUniformBlockquoteDoc());
	expect(await cstBlockCount(page)).toBe(1);
	expect(
		await page.evaluate(() => document.querySelectorAll('.blockquote-block .vr-spacer').length)
	).toBeGreaterThan(0);

	// Progressive: the reseed is only observable where measured heights around the anchor
	// diverge from the reseed estimate.
	const scrollHeight = await editorScrollHeight(page);
	const target = Math.round(scrollHeight / 2);
	await progressiveScrollTo(editor, target);
	await editor.waitForRenderFlush();

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

	// Child 0 is well above the viewport, in the unmounted region; `spliceContainerChildren`
	// keeps `childIds` in lockstep so the rebuild fires with a valid id and no scroll move.
	await page.evaluate(() => {
		const tall = `> inserted${'<br>line'.repeat(30)}\n`;
		(window as any).__test.spliceContainerChildren([0], 0, 0, tall);
	});
	expect(
		await page.evaluate(() => (window as any).__test.getDocument().children[0].children.length)
	).toBe(childCountBefore + 1);
	await editor.waitForRenderFlush();

	// The anchor child sits at childIndex+1 after the above-fold insert; without the id-remap
	// the numeric correction over-shoots and it jumps by ~one inserted-block height.
	const after = await page.evaluate((childIndex) => {
		const host = document.querySelector(
			`[data-block-path='${JSON.stringify([0, childIndex])}']`
		) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, before.childIndex + 1);

	const drift = after !== null ? Math.abs(after - before.y) : Infinity;
	console.log(`F4 anchor-remap ${JSON.stringify({ ...before, after, drift })}`);

	expect(after).not.toBeNull();
	// 40px sits below the inserted block's height (the buggy displacement) and above noise.
	expect(drift).toBeLessThan(40);
	expect(pageErrors).toEqual([]);
});

// F6: column-width stability under row windowing. `minmax(80px, max-content)` sizes a track to
// its currently-MOUNTED cells, so the column reflows mid-scroll once its widest cell unmounts;
// the fix pins each track to the widest cell seen so far (monotonic-grow floor).
test('a column does not shrink when its widest cell scrolls out of the window (F6)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Exactly one wide cell, near the top: column 0's max-content is driven entirely by it,
	// so a deep scroll that unmounts its row is what collapses the track.
	const wide = 'wordwordword '.repeat(20).trim();
	const header = '| a | b | c |\n| --- | --- | --- |\n';
	const wideRow = `| ${wide} | y | z |\n`;
	const body = Array.from({ length: 800 }, () => `| p | q | r |`).join('\n') + '\n';
	await editor.loadContent(header + wideRow + body);

	// Without row windowing the wide cell never unmounts and the test is vacuous.
	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);

	// Any mounted row reports the shared track width; the wide row is in the initial window.
	const widthBefore = await page.evaluate(() => {
		const cell = document.querySelector('[data-table-row-idx] > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().width : null;
	});
	expect(widthBefore).not.toBeNull();
	// Sanity: the wide cell really did stretch column 0 well past the 80px floor.
	expect(widthBefore!).toBeGreaterThan(200);

	const scrollHeight = await editorScrollHeight(page);
	await editor.scrollEditorTo(Math.round(scrollHeight * 0.9));
	await editor.waitForRenderFlush();

	// If the wide row is still in the DOM the column stays wide for the wrong reason.
	expect(await page.evaluate(() => document.querySelector('[data-table-row-idx="1"]'))).toBeNull();

	const widthAfter = await page.evaluate(() => {
		const cell = document.querySelector('[data-table-row-idx] > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().width : null;
	});
	console.log(`F6 column-stability ${JSON.stringify({ widthBefore, widthAfter })}`);

	expect(widthAfter).not.toBeNull();
	// 0.9x tolerates sub-pixel jitter while failing hard on the multi-hundred-px collapse
	// toward the 80px floor that an unpinned track produces.
	expect(widthAfter!).toBeGreaterThan(widthBefore! * 0.9);
	expect(pageErrors).toEqual([]);
});

// F7: with no content scrolled above the viewport top (localScrollTop === 0), the list scope's
// `correctAnchorByStableId` would FOLLOW the relocated block and shift the shared scrollTop.
// One Alt+Up + Alt+Down is a structural no-op, so scrollTop must return to baseline.
test('reordering a list item below the fold does not drift scrollTop (F7)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Filler both sides so the list can drift either way rather than clamp at a boundary;
	// ALPHA tall and BETA short so the anchor-follow delta is non-zero and asymmetric.
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

	// Scroll until the list mounts, then leave its top ~250px below the editor's viewport top,
	// which is what makes the list scope's localScrollTop 0.
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

	// Baseline is taken AFTER the click so any click-induced scroll is absorbed into it.
	await page.locator('[contenteditable="true"]', { hasText: 'ZBETAITEM' }).click();
	await editor.waitForRenderFlush();

	const listTopRel = (await offsetOf('ZALPHAITEM'))! - (await scrollTopOf(page));
	// Without this the test cannot reach the buggy branch.
	expect(listTopRel, 'list must sit below the viewport top (localScrollTop===0)').toBeGreaterThan(
		50
	);

	const baseline = await scrollTopOf(page);

	// Ordered markers renumber, so the reorder is observable through the serialized source.
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
