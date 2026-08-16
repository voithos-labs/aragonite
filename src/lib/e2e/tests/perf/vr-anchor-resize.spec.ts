import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	FIXTURE_BYTES,
	MAX_UNMOUNTED_EDGE_FRACTION,
	TOP_LEVEL_HOSTS,
	editorScrollHeight,
	mountedViewportSpan,
	progressiveScrollTo,
	spacerCount
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// VR-1 resize invalidation, on its two independent axes. WIDTH re-wraps prose and stales the
// measured cache, so the model rebuilds and re-measures. HEIGHT re-wraps nothing and spares
// that cache, but it moves the SLICE — the window's extent is derived from the scrollport's
// height — so the two axes carry separate signals and separate scenarios.

const VIEWPORT = { width: 1280, height: 720 };

// Width-SENSITIVE prose that re-wraps as the column narrows, so a width change really moves
// every height (a `<br>` fixture's hard breaks would not).
const WIDE_PROSE_BLOCKS = 900;
function buildWideProseDoc(): string {
	const line = Array.from({ length: 60 }, (_, w) => `word${w % 16}`).join(' ');
	return Array.from({ length: WIDE_PROSE_BLOCKS }, () => line).join('\n\n') + '\n';
}

/** The first mounted top-level host clearing the editor's viewport top, measured RELATIVE to
 *  the editor: a resize reflows the harness chrome above the slot, a shift the anchor
 *  correction does not own. */
function anchorInEditor(page: Page): Promise<{ path: string; topInEditor: number } | null> {
	return page.evaluate((sel) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const editorTop = editorEl.getBoundingClientRect().top;
		for (const host of Array.from(document.querySelectorAll(`.editor ${sel}`)) as HTMLElement[]) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > editorTop + 1)
				return { path: host.getAttribute('data-block-path')!, topInEditor: rect.top - editorTop };
		}
		return null;
	}, TOP_LEVEL_HOSTS);
}

function hostTopInEditor(page: Page, path: string): Promise<number | null> {
	return page.evaluate((p) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const host = document.querySelector(`[data-block-path='${p}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top - editorEl.getBoundingClientRect().top : null;
	}, path);
}

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

	const anchor = await anchorInEditor(page);
	expect(anchor).not.toBeNull();
	const before = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		return { width: editorEl.clientWidth, scrollHeight: editorEl.scrollHeight };
	});

	// Narrow enough to re-wrap every paragraph, firing the editor's width ResizeObserver.
	await page.setViewportSize({ width: 760, height: 900 });
	for (let i = 0; i < 5; i++) await editor.waitForRenderFlush();

	const after = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		return { width: editorEl.clientWidth, scrollHeight: editorEl.scrollHeight };
	});
	const anchorTopAfter = await hostTopInEditor(page, anchor!.path);
	const drift = anchorTopAfter !== null ? Math.abs(anchorTopAfter - anchor!.topInEditor) : Infinity;
	console.log(`VR-1 narrow ${JSON.stringify({ ...before, ...after, drift })}`);

	expect(after.width).toBeLessThan(before.width - 100);

	// (1) Re-measure: without the width wiring the model keeps wide heights and scrollHeight
	// barely moves, so the 10% growth bound fails on the revert.
	expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight * 1.1);

	// (2) Anchor: ONE correction across ONE model transition holds to well under a line, so
	// 20px sits far above the residual and far below a one-block slip.
	expect(anchorTopAfter).not.toBeNull();
	expect(drift).toBeLessThan(20);
	expect(pageErrors).toEqual([]);
});

// The height axis. The width observer returns on a height-only change by design, and the
// scrollport's height is a plain DOM read inside the window derived — so without its own
// invalidation signal the slice never recomputes and the newly exposed band stays bare
// spacer until any scroll or keystroke.
test('growing the viewport height alone extends the mounted band into the exposed area', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await page.setViewportSize(VIEWPORT);
	await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);

	// Mid-document, so the slice is genuinely windowed rather than pinned at the doc start.
	await editor.scrollEditorTo(Math.round((await editorScrollHeight(page)) / 2));
	await editor.waitForRenderFlush();
	expect(await spacerCount(page)).toBeGreaterThan(0);

	const anchor = await anchorInEditor(page);
	expect(anchor).not.toBeNull();

	// HEIGHT only — the same width, so nothing re-wraps and the measured cache must survive.
	await page.setViewportSize({ width: VIEWPORT.width, height: Math.round(VIEWPORT.height * 2.2) });
	await editor.waitForRenderFlush();

	const span = await mountedViewportSpan(page, TOP_LEVEL_HOSTS);
	const anchorTopAfter = await hostTopInEditor(page, anchor!.path);
	console.log(`VR height-only ${JSON.stringify({ ...span, anchorTopAfter })}`);

	// The failure this pins: the mounted set is unchanged, so the bottom of the taller
	// viewport is bare spacer (~40% of it, measured).
	expect(span.bottomGapPx).toBeLessThan(span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION);
	expect(span.topGapPx).toBeLessThan(span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION);

	// And the newly-running correction must not throw the reader while it fills the band.
	expect(anchorTopAfter).not.toBeNull();
	expect(Math.abs(anchorTopAfter! - anchor!.topInEditor)).toBeLessThan(60);
	expect(pageErrors).toEqual([]);
});
