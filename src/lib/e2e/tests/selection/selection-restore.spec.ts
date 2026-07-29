import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
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

// A trailing image with no dimension hint: it reserves the placeholder floor until it
// decodes, then grows. Short enough overall to keep windowing inactive (every block
// mounted, so the trailing image's ResizeObserver fires at all) while still scrolling.
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

/** Hold the image response until the returned release is called, so its growth lands
 *  after the restore instead of racing it. */
async function deferImage(page: Page): Promise<() => void> {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('https://e2e-deferred.test/**', async (route) => {
		await gate;
		await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LATE_IMAGE_SVG });
	});
	return release;
}

const imageHostHeight = (page: Page) =>
	page.evaluate(() => {
		const host = document.querySelector('[data-image-widget]')?.closest('.block-host');
		return host ? (host as HTMLElement).getBoundingClientRect().height : 0;
	});

/**
 * Bring an off-window block into view, then land a real caret in it. Setting
 * `scrollTop` to the maximum is NOT equivalent: the windowed scroll height is an
 * estimate that only converges once the tail mounts, so a single scroll-to-max
 * leaves the last block a few pixels below the fold and the click lands on <body>.
 * The shipped reveal has no such gap — it is what a host calls to get there.
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

test.describe('selection — setSelection restores a getSelection snapshot', () => {
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

		// Push the target past the fold but keep it inside the overscan band, where
		// the mount primitive short-circuits with no scroll. This is where a host
		// lands after an ordinary user scroll — the state every other in-view
		// scenario skips by windowing the target out completely.
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

	// A subscriber reads the editor back on `selectionChange`, so what a restore owes
	// it is not only the settled value but every payload of the burst — a
	// persist-on-change host writes the FIRST one. The collapsed route's `clear()`
	// used to notify while the caret still sat where it was leaving.
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

			// Exactly two, and the number is the contract, not an accident: the state
			// channel's batched flush plus the browser's own `selectionchange` bridge,
			// which is the sole emitter for intra-block caret motion and so cannot be
			// silenced. A third would mean a mutator escaped the restore's batch; a
			// first would mean the bridge stopped seeing the placed range.
			expect(emissions).toHaveLength(2);
			for (const emission of emissions) expect(emission).toEqual(restored);
		});
	}

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

	// The other first-class selection class beside the caret, and the one restore
	// route the collapsed and cross-block scenarios never touch: a same-path pair
	// with distinct offsets goes native, not through the overlay.
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
		await page.locator('[role="cell"]').nth(8).click();
		await editor.waitForCrossBlock(false);

		expect(await editor.bridge.setSelection(snapshot!)).toBe(true);
		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.getSelection()).toEqual(snapshot);
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
		// Reading mode turns contenteditable off, so no block can hold the caret as
		// activeElement — the native range is the observable that reading keeps
		// selection alive.
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

	// A host that restores a caret AND a remembered scroll position does both in that
	// order — the scroll is the outer state, the caret the inner one. Until the reveal
	// anchor was released on resolve, `setSelection` kept a durable top-pin on the
	// restored block: any later measure pass (a diagram, display math or an image
	// settling in after mount) re-asserted it and threw the host's scroll away.
	test('hands the scroll position back once it resolves', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		// After the harness is up (beforeEach) but before any content asks for the image.
		const releaseImage = await deferImage(page);

		await editor.loadContent(lateGrowthDoc());
		await editor.waitForRenderFlush();
		await editor.waitForResizeObserverFlush();

		// The host's own restore order: place the remembered caret, then the remembered
		// scroll. Block 0 is the caret target, so the pin the bug held is the document top.
		expect(await editor.bridge.setSelection(DOCUMENT_START)).toBe(true);
		await editor.scrollEditorTo(400);

		// Read the baseline back rather than asserting the number asked for: measuring
		// the blocks that mount on the way down legitimately nudges the top-of-viewport
		// correction, and that is the honest landing. Far from the document top is the
		// precondition — while the pin was held, this read was already back at block 0.
		const hostTop = await scrollTopOf(page);
		expect(hostTop).toBeGreaterThan(200);
		const collapsedHeight = await imageHostHeight(page);

		// The image grows BELOW the fold, so the honest top-of-viewport correction is a
		// no-op — nothing above the anchor block moved, so its offset is unchanged and
		// the delta is exactly zero. Any movement at all is the pin re-asserting.
		releaseImage();
		await expect.poll(() => imageHostHeight(page)).toBeGreaterThan(collapsedHeight + 50);
		await editor.waitForResizeObserverFlush();

		expect(await scrollTopOf(page)).toBe(hostTop);
		expect(pageErrors).toEqual([]);
	});
});
