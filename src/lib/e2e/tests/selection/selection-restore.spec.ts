import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
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
});
