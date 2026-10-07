import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors, deferImage } from '../../page-probes';
import type { EditorSelection } from '../../../selection/primitives';
import { dragBetweenCells } from '../blocks/table/helpers';

const PROSE = 'Alpha one\n\nBravo two\n\nCharlie three\n';
const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

// Short paragraphs plus a unique tail marker: tall enough to activate windowing,
// so the last block is unmounted whenever the viewport sits at the top.
function windowedDoc(blockCount: number): string {
	const blocks = Array.from({ length: blockCount - 1 }, (_, i) => `paragraph ${i} with some words`);
	blocks.push('ZZENDMARKER final block');
	return blocks.join('\n\n') + '\n';
}

const wrapperFor = (page: Page, path: number[]) =>
	page.locator(`[data-block-path='${JSON.stringify(path)}']`);

// What a host restores into a document it has never scrolled: the very first block.
const DOCUMENT_START = {
	anchor: { path: [0], offset: 0 },
	focus: { path: [0], offset: 0 }
};

const scrollTopOf = (page: Page) =>
	page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);

// A trailing image with no size hint grows once it decodes; short enough to keep windowing off,
// so its ResizeObserver fires at all, while still scrolling.
const LATE_IMAGE_URL = 'https://e2e-deferred.test/late-growth.svg';
const LATE_IMAGE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';

function lateGrowthDoc(): string {
	const blocks = Array.from(
		{ length: 55 },
		(_, i) => `paragraph ${i} with enough text to fill a line.`
	);
	blocks.push(`![late](${LATE_IMAGE_URL})`);
	return blocks.join('\n\n') + '\n';
}

const imageHostHeight = (page: Page) =>
	page.evaluate(() => {
		const host = document.querySelector('[data-image-widget]')?.closest('.block-host');
		return host ? (host as HTMLElement).getBoundingClientRect().height : 0;
	});

/**
 * Setting `scrollTop` to the maximum is not enough: the windowed height is an estimate until the
 * tail mounts, so the last block stays below the viewport and the click lands on `<body>`.
 */
async function revealAndClick(
	editor: EditorPage,
	page: Page,
	path: number[],
	offset: number
): Promise<void> {
	await page.evaluate((p) => (window as any).__test.rects.scrollTo(p, { block: 'center' }), path);
	await editor.waitForRenderFlush();
	await editor.clickBlockAtPath(path, offset);
}

test.describe('selection: setSelection restores a getSelection snapshot', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('restores a collapsed caret at the exact offset', async () => {
		await editor.loadContent(PROSE);
		await editor.clickBlockAtPath([1], 5);
		const snapshot = await editor.bridge.getSelection();
		expect(snapshot).toEqual({
			anchor: { path: [1], offset: 5 },
			focus: { path: [1], offset: 5 }
		});

		await editor.clickBlockAtPath([2], 0);
		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		expect(await editor.bridge.getSelection()).toEqual(snapshot);
	});

	test('restores a caret into a windowed-out block and brings it into view', async ({ page }) => {
		await editor.loadContent(windowedDoc(201));
		await editor.waitForRenderFlush();
		const marker = wrapperFor(page, [200]);

		await revealAndClick(editor, page, [200], 3);
		const snapshot = await editor.bridge.getSelection();
		expect(snapshot).toEqual({
			anchor: { path: [200], offset: 3 },
			focus: { path: [200], offset: 3 }
		});

		// Back to the top: the marker leaves the window entirely, so a synchronous
		// focus would have nothing to place a caret in (VR-12).
		await editor.scrollEditorTo(0);
		await expect(marker).toHaveCount(0);

		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		await expect(marker).toBeInViewport();
		expect(await editor.bridge.getSelection()).toEqual(snapshot);
	});

	test('scrolls a still-mounted block back into view', async ({ page }) => {
		await editor.loadContent(windowedDoc(201));
		await editor.waitForRenderFlush();
		const target = wrapperFor(page, [80]);

		await revealAndClick(editor, page, [80], 3);
		const snapshot = await editor.bridge.getSelection();
		expect(snapshot?.focus.path).toEqual([80]);

		// Past the viewport but inside the band windowing mounts ahead, where the mount returns early
		// with no scroll, a state the other in-view scenarios skip.
		const scrolled = await page.evaluate(() => {
			const el = document.querySelector('.editor') as HTMLElement;
			el.scrollTop += 400;
			return el.scrollTop;
		});
		await editor.waitForRenderFlush();
		await expect(target).toBeAttached();
		await expect(target).not.toBeInViewport();

		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		await expect(target).toBeInViewport();
		expect(
			await page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop)
		).not.toBe(scrolled);
	});

	test('brings a mounted block below the viewport to its bottom edge, not the middle', async ({
		page
	}) => {
		await editor.loadContent(windowedDoc(201));
		await editor.waitForRenderFlush();
		const target = wrapperFor(page, [80]);

		await revealAndClick(editor, page, [80], 3);
		const snapshot = await editor.bridge.getSelection();

		// Just below the viewport, inside the band windowing mounts ahead.
		await page.evaluate(() => {
			const el = document.querySelector('.editor') as HTMLElement;
			el.scrollTop -= el.clientHeight / 2 + 120;
		});
		await editor.waitForRenderFlush();
		await expect(target).toBeAttached();
		await expect(target).not.toBeInViewport();

		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		await editor.waitForRenderFlush();
		const gap = await page.evaluate(() => {
			const view = document.querySelector('.editor') as HTMLElement;
			const block = document.querySelector("[data-block-path='[80]']") as HTMLElement;
			const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
			return bottom - block.getBoundingClientRect().bottom;
		});
		expect(Math.abs(gap)).toBeLessThanOrEqual(2);
	});

	// A host saving on every change writes the burst's first payload, so notifying while the caret
	// still sits where it is leaving corrupts what the host stores.
	const RESTORE_ROUTES: Array<[string, EditorSelection]> = [
		['collapsed caret', { anchor: { path: [0], offset: 3 }, focus: { path: [0], offset: 3 } }],
		['within-block range', { anchor: { path: [0], offset: 1 }, focus: { path: [0], offset: 6 } }]
	];
	for (const [name, restored] of RESTORE_ROUTES) {
		test(`a ${name} restore never emits the pre-restore selection`, async ({ page }) => {
			await editor.loadContent(PROSE);
			await editor.clickBlockAtPath([2], 4);

			await page.evaluate(() => (window as any).__test.startSelectionChangeCapture());
			expect(await editor.bridge.setSelection(restored)).toBe(true);
			await editor.waitForRenderFlush();
			const emissions = await page.evaluate(() =>
				(window as any).__test.stopSelectionChangeCapture()
			);

			// Exactly one: the restore announces the selection itself, and the browser's
			// `selectionchange` that follows repeats a position subscribers already have.
			expect(emissions).toHaveLength(1);
			for (const emission of emissions) {
				expect({ anchor: emission.anchor, focus: emission.focus }).toEqual(restored);
			}
		});
	}

	test('a caret on a list path lands in its first item, where typing reaches', async () => {
		await editor.loadContent('- a\n- b\n');
		await editor.clickBlockAtPath([0, 1, 0], 1);

		const onList = { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 0 } };
		expect(await editor.bridge.setSelection(onList)).toBe(true);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceEquals('- xa\n- b\n');
	});

	test('an offset past the end clamps to the block end', async () => {
		await editor.loadContent(PROSE);
		await editor.clickBlockAtPath([0], 0);

		const past = { anchor: { path: [1], offset: 999 }, focus: { path: [1], offset: 999 } };
		expect(await editor.bridge.setSelection(past)).toBe(true);
		expect(await editor.bridge.getSelection()).toEqual({
			anchor: { path: [1], offset: 'Bravo two'.length },
			focus: { path: [1], offset: 'Bravo two'.length }
		});
	});

	// The one restore path the collapsed and cross-block scenarios never touch: a pair on the same
	// path with different offsets goes native, not through the overlay.
	test('restores a within-block range across the same offsets', async () => {
		await editor.loadContent(PROSE);
		await editor.clickBlockAtPath([1], 2);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		const snapshot = await editor.bridge.getSelection();
		expect(snapshot).toEqual({
			anchor: { path: [1], offset: 2 },
			focus: { path: [1], offset: 7 }
		});

		await editor.clickBlockAtPath([2], 0);
		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		expect(await editor.bridge.getSelection()).toEqual(snapshot);
	});

	test('restores a cross-block range and repaints the overlay', async ({ page }) => {
		await editor.loadContent(PROSE);
		await editor.dragFromTo([0], 2, [2], 4);
		await editor.waitForCrossBlock(true);
		const snapshot = await editor.bridge.getSelection();

		await editor.clickBlockAtPath([1], 0);
		await editor.waitForCrossBlock(false);

		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.getSelection()).toEqual(snapshot);
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});

	test('restores an intra-table cell rectangle', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		const snapshot = await editor.bridge.getSelection();

		// Collapse into a cell outside the rectangle. Table cells carry no
		// data-block-path (no BlockHost), so they are addressed by role.
		await page.locator('.table-cell').nth(8).click();
		await editor.waitForCrossBlock(false);

		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.getSelection()).toEqual(snapshot);
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});

	// A host's rectangle built from plain numbers carries no cell flag; the table path alone says
	// the offsets count cells.
	test('plain offsets on a table path paint a cell rectangle', async ({ page }) => {
		await editor.loadContent(TABLE_3x3);
		expect(
			await editor.bridge.setSelection({
				anchor: { path: [0], offset: 0 },
				focus: { path: [0], offset: 4 }
			})
		).toBe(true);
		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.getSelection()).toEqual({
			anchor: { path: [0], offset: 0, cellCoordinate: true },
			focus: { path: [0], offset: 4, cellCoordinate: true }
		});
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});

	test('places the selection in reading mode', async ({ page }) => {
		await editor.loadContent(PROSE);
		await editor.clickBlockAtPath([1], 5);
		const snapshot = await editor.bridge.getSelection();
		await editor.clickBlockAtPath([2], 0);

		await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
		await editor.waitForRenderFlush();

		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		// Reading mode turns contenteditable off, so no block holds the caret as `activeElement`, and
		// the native range is the only sign the selection survives.
		const rangeInTarget = await page.evaluate(
			(attr) => {
				const sel = window.getSelection();
				if (!sel || sel.rangeCount === 0) return false;
				const wrapper = document.querySelector(`[data-block-path='${attr}']`);
				return !!wrapper && wrapper.contains(sel.getRangeAt(0).startContainer);
			},
			JSON.stringify([1])
		);
		expect(rangeInTarget).toBe(true);
	});

	test('an unresolvable path resolves false without scrolling or stealing focus', async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);

		await editor.loadContent(windowedDoc(201));
		await revealAndClick(editor, page, [200], 3);
		const snapshot = await editor.bridge.getSelection();
		expect(snapshot?.focus.path).toEqual([200]);

		// Still long enough to scroll, but block 200 is gone.
		await editor.loadContent(windowedDoc(100));
		await editor.scrollEditorTo(800);
		// Stash the element itself, not a description: two blocks of the same kind
		// share every attribute, so only identity proves focus did not move.
		const before = await page.evaluate(() => {
			(window as any).__activeBefore = document.activeElement;
			return (document.querySelector('.editor') as HTMLElement).scrollTop;
		});

		expect(await editor.bridge.setSelection(snapshot!)).toBe(false);

		expect(
			await page.evaluate(() => ({
				scrollTop: (document.querySelector('.editor') as HTMLElement).scrollTop,
				sameActive: document.activeElement === (window as any).__activeBefore
			}))
		).toEqual({ scrollTop: before, sameActive: true });
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		expect(pageErrors).toEqual([]);
	});

	// A host restoring both a caret and a scroll position scrolls last, so a lasting hold on the
	// restored block's top would throw that scroll away on the next measure pass.
	test('hands the scroll position back once it resolves', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		// After the harness is up (beforeEach) but before any content asks for the image.
		const releaseImage = await deferImage(page, LATE_IMAGE_SVG);

		await editor.loadContent(lateGrowthDoc());
		await editor.waitForRenderFlush();
		await editor.waitForResizeObserverFlush();

		// The host's own restore order: caret, then scroll. Block 0 is the caret target, so a lasting
		// hold would pull back to the document top.
		expect(await editor.bridge.setSelection(DOCUMENT_START)).toBe(true);
		await editor.scrollEditorTo(400);

		// Read back rather than asserted, since measuring blocks on the way down nudges the correction;
		// being far from the top is the precondition.
		const hostTop = await scrollTopOf(page);
		expect(hostTop).toBeGreaterThan(200);
		const collapsedHeight = await imageHostHeight(page);

		// The image grows below the viewport, so the ordinary correction does nothing and any movement
		// at all is the hold re-applying.
		releaseImage();
		await expect.poll(() => imageHostHeight(page)).toBeGreaterThan(collapsedHeight + 50);
		await editor.waitForResizeObserverFlush();

		expect(await scrollTopOf(page)).toBe(hostTop);
		expect(pageErrors).toEqual([]);
	});
});
