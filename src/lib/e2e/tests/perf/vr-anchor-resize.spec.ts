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

// VR-1, throwing away measurements on a resize, in its two separate cases. A change of width
// re-wraps the prose and makes every measurement stale, so the height table rebuilds and
// measures again. A change of height re-wraps nothing and keeps those measurements, but it
// changes how many blocks are mounted, since that comes from the scroll container's height. So
// the two cases carry different signals and get different scenarios.

const VIEWPORT = { width: 1280, height: 720 };

// Prose that re-wraps as the column narrows, so a change of width really moves every height,
// which a fixture full of hard `<br>` breaks would not.
const WIDE_PROSE_BLOCKS = 900;
function buildWideProseDoc(): string {
	const line = Array.from({ length: 60 }, (_, w) => `word${w % 16}`).join(' ');
	return Array.from({ length: WIDE_PROSE_BLOCKS }, () => line).join('\n\n') + '\n';
}

/** The first mounted top-level block below the editor's viewport top, measured against the
 *  editor: a resize reflows the harness's own header above it, and that shift is not the
 *  scroll correction's doing. */
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

	// Blocks above the window go from one estimate to another either way; only the stretch
	// measured at the wide width shows whether it measures again.
	const wideScrollHeight = await editorScrollHeight(page);
	await progressiveScrollTo(editor, Math.round(wideScrollHeight / 2));

	const anchor = await anchorInEditor(page);
	expect(anchor).not.toBeNull();
	const before = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		return { width: editorEl.clientWidth, scrollHeight: editorEl.scrollHeight };
	});

	// Narrow enough to re-wrap every paragraph, which fires the editor's width observer.
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

	// (1) Measuring again: without the width wiring the height table keeps the wide heights and
	// scrollHeight barely moves, so the 10% growth check fails once the wiring is removed.
	expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight * 1.1);

	// (2) The scroll: one correction across one rebuild holds to well under a line of text, so
	// 20px is far above what is left over and far below slipping by a whole block.
	expect(anchorTopAfter).not.toBeNull();
	expect(drift).toBeLessThan(20);
	expect(pageErrors).toEqual([]);
});

// The height case. The width observer ignores a change of height by design, and the scroll
// container's height is read straight from the DOM while the window is worked out, so without a
// signal of its own nothing recomputes and the newly uncovered stretch stays bare spacer until
// the next scroll or keystroke.
test('growing the viewport height alone extends the mounted band into the exposed area', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await page.setViewportSize(VIEWPORT);
	await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);

	// Mid-document, so the mounted blocks are a real window rather than the start of it.
	await editor.scrollEditorTo(Math.round((await editorScrollHeight(page)) / 2));
	await editor.waitForRenderFlush();
	expect(await spacerCount(page)).toBeGreaterThan(0);

	const anchor = await anchorInEditor(page);
	expect(anchor).not.toBeNull();

	// Height only, at the same width, so nothing re-wraps and the measurements must survive.
	await page.setViewportSize({ width: VIEWPORT.width, height: Math.round(VIEWPORT.height * 2.2) });
	await editor.waitForRenderFlush();

	const span = await mountedViewportSpan(page, TOP_LEVEL_HOSTS);
	const anchorTopAfter = await hostTopInEditor(page, anchor!.path);
	console.log(`VR height-only ${JSON.stringify({ ...span, anchorTopAfter })}`);

	// The failure this catches: nothing new mounts, so the bottom of the taller viewport is
	// bare spacer, about 40% of it as measured.
	expect(span.bottomGapPx).toBeLessThan(span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION);
	expect(span.topGapPx).toBeLessThan(span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION);

	// And the correction, now running, must not move the user while it fills that stretch.
	expect(anchorTopAfter).not.toBeNull();
	expect(Math.abs(anchorTopAfter! - anchor!.topInEditor)).toBeLessThan(60);
	expect(pageErrors).toEqual([]);
});
