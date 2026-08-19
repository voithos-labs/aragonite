import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { count, openFind, typeQuery } from './helpers';

// The needle is spread across rows so the ACTIVE match is revealed at the top while deep
// matching rows start off-window: search auto-reveals only the active match, and the rest
// must repaint when scrolled into view (#3).
function bigTable(): string {
	const head = '| Col A | Col B |\n| :--- | :--- |\n';
	const rows = Array.from({ length: 200 }, (_, i) =>
		i % 20 === 0 ? `| row ${i} | ZZNEEDLE |\n` : `| row ${i} | data ${i} |\n`
	).join('');
	return head + rows;
}

// Is a mounted cell whose text contains `needle` present at all?
function needleMounted(page: Page): Promise<boolean> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-table-row-idx] .table-cell')).some((c) =>
			(c.textContent ?? '').includes('ZZNEEDLE')
		)
	);
}

// Is row 180 (the deepest needle row) mounted?
function row180Mounted(page: Page): Promise<boolean> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-table-row-idx] .table-cell')).some(
			(c) => (c.textContent ?? '').trim() === 'row 180'
		)
	);
}

// After scrolling, find a cell fully inside the editor viewport (insets trim the accepted
// band; a needle filters to matching cells) and report whether an overlay of the given
// selector geometrically covers it — the repaint discriminator.
function coveredCell(
	page: Page,
	args: { overlaySelector: string; needle?: string; insetTop: number; insetBottom: number }
): Promise<{ found: boolean; covered: boolean }> {
	return page.evaluate(({ overlaySelector, needle, insetTop, insetBottom }) => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const cells = Array.from(
			document.querySelectorAll('[data-table-row-idx] .table-cell')
		) as HTMLElement[];
		const cell = cells.find((c) => {
			if (needle && !(c.textContent ?? '').includes(needle)) return false;
			const r = c.getBoundingClientRect();
			return r.height > 0 && r.top >= ed.top + insetTop && r.bottom <= ed.bottom + insetBottom;
		});
		if (!cell) return { found: false, covered: false };
		const cr = cell.getBoundingClientRect();
		const overlays = Array.from(document.querySelectorAll(overlaySelector)) as HTMLElement[];
		const covered = overlays.some((o) => {
			const r = o.getBoundingClientRect();
			return (
				r.width > 0 &&
				r.height > 0 &&
				r.left < cr.right &&
				r.right > cr.left &&
				r.top < cr.bottom &&
				r.bottom > cr.top
			);
		});
		return { found: true, covered };
	}, args);
}

const deepNeedleCovered = (page: Page) =>
	coveredCell(page, {
		overlaySelector: '.match-overlay',
		needle: 'ZZNEEDLE',
		insetTop: -1,
		insetBottom: 1
	});

test('a deep off-window table-row match repaints its highlight after a single scroll into view', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);

	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(bigTable());
	await editor.waitForRenderFlush();

	// Preconditions: row windowing active and the deepest needle row is off-window.
	// If either fails this is NOT a valid RED.
	expect(await page.locator('.vr-spacer').count()).toBeGreaterThan(0);
	expect(await row180Mounted(page)).toBe(false);

	await openFind(editor);
	await typeQuery(editor, 'ZZNEEDLE');
	await expect(count(page)).toHaveText(/1\s*\/\s*10/);
	await editor.waitForRenderFlush();

	// The active (first) match is revealed at the top; the deep match (row 180)
	// must still be off-window, or there is nothing to repaint on scroll-in.
	expect(await needleMounted(page)).toBe(true); // sanity: the active match is mounted
	expect(await row180Mounted(page)).toBe(false);

	// SINGLE vertical scroll to bring the deep matching rows into the mounted window.
	// No second nudge — that constraint is the discriminator.
	await page.evaluate(() => {
		const ed = document.querySelector('.editor') as HTMLElement;
		ed.scrollTop = ed.scrollHeight;
	});
	await editor.waitForRenderFlush();

	// Poll the scroll-in outcome directly: the deep row mounts, then a needle cell
	// is visible with its match highlight repainted over it.
	await expect.poll(() => row180Mounted(page)).toBe(true);
	await expect.poll(() => deepNeedleCovered(page)).toEqual({ found: true, covered: true });
	expect(pageErrors).toEqual([]);
});

// The SelectionOverlay repaint discriminator, sibling to the search one; the top inset
// keeps the probe off the intro paragraph's band.
const visibleCellCovered = (page: Page) =>
	coveredCell(page, { overlaySelector: '.selection-overlay', insetTop: 40, insetBottom: -1 });

test('a cross-block selection repaints over a deep off-window table row after scroll-in', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);

	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('intro paragraph\n\n' + bigTable());
	await editor.waitForRenderFlush();

	expect(await page.locator('.vr-spacer').count()).toBeGreaterThan(0);
	expect(await row180Mounted(page)).toBe(false);

	// Cross-block select from the intro paragraph to the end of the document, so the
	// table is the focus endpoint and its cells are part of the selection.
	await editor.clickBlock(0);
	await page.keyboard.press('ControlOrMeta+Shift+End');
	await editor.waitForRenderFlush();
	expect(await editor.bridge.isCrossBlockSelection()).toBe(true);

	// Single scroll to bring deep rows into the mounted window.
	await page.evaluate(() => {
		const ed = document.querySelector('.editor') as HTMLElement;
		ed.scrollTop = ed.scrollHeight;
	});
	await editor.waitForRenderFlush();

	// Poll the scroll-in outcome directly: the deep row mounts, then a visible cell
	// carries the repainted selection highlight.
	await expect.poll(() => row180Mounted(page)).toBe(true);
	await expect.poll(() => visibleCellCovered(page)).toEqual({ found: true, covered: true });
	expect(pageErrors).toEqual([]);
});
