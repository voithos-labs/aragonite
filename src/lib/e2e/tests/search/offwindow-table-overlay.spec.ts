import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import { capturePageErrors } from '../../page-probes';

const findInput = (page: Page) => page.getByRole('textbox', { name: 'Find' });

// Needle in many spread-out rows so the ACTIVE (first) match is revealed at the
// top while DEEP matching rows start off-window. Search auto-reveals only the
// active match; the off-window ones must repaint when scrolled into view (#3).
// ~200 body rows clears the 4000px row-window watermark.
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

// After scrolling, find a needle cell fully inside the editor viewport and report
// whether a .match-overlay geometrically covers it (the repaint discriminator).
function deepNeedleCovered(page: Page): Promise<{ found: boolean; covered: boolean }> {
	return page.evaluate(() => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const cells = Array.from(
			document.querySelectorAll('[data-table-row-idx] .table-cell')
		) as HTMLElement[];
		const needleCell = cells.find((c) => {
			if (!(c.textContent ?? '').includes('ZZNEEDLE')) return false;
			const r = c.getBoundingClientRect();
			return r.height > 0 && r.top >= ed.top - 1 && r.bottom <= ed.bottom + 1;
		});
		if (!needleCell) return { found: false, covered: false };
		const cr = needleCell.getBoundingClientRect();
		const overlays = Array.from(document.querySelectorAll('.match-overlay')) as HTMLElement[];
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
	});
}

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

	await editor.clickBlock(0);
	await page.keyboard.press(`${primaryModifier}+f`);
	await findInput(page).waitFor({ state: 'visible' });
	await page.keyboard.type('ZZNEEDLE');
	await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*10/);
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

// Whether a .selection-overlay geometrically covers a cell currently visible in the
// editor viewport — the SelectionOverlay repaint discriminator, sibling to the search one.
function visibleCellCovered(page: Page): Promise<{ found: boolean; covered: boolean }> {
	return page.evaluate(() => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const cells = Array.from(
			document.querySelectorAll('[data-table-row-idx] .table-cell')
		) as HTMLElement[];
		const cell = cells.find((c) => {
			const r = c.getBoundingClientRect();
			return r.height > 0 && r.top >= ed.top + 40 && r.bottom <= ed.bottom - 1;
		});
		if (!cell) return { found: false, covered: false };
		const cr = cell.getBoundingClientRect();
		const overlays = Array.from(document.querySelectorAll('.selection-overlay')) as HTMLElement[];
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
	});
}

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
	await page.keyboard.press(`${primaryModifier}+Shift+End`);
	await editor.waitForRenderFlush();
	expect(await page.evaluate(() => (window as any).__test.isCrossBlockSelection?.() ?? false)).toBe(
		true
	);

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
