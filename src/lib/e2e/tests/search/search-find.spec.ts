import { test, expect } from '../../fixtures';
import { capturePageErrors } from '../../page-probes';
import { EditorPage } from '../../editor-page';
import { activeOverlays, count, findInput, openFind, overlays, typeQuery } from './helpers';

test.describe('search — find and highlight', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha beta\n\ngamma alpha\n\nalpha delta\n');
	});

	test('typing a query paints one overlay per match and reads 1 / N', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(3);
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
		await expect(activeOverlays(page)).toHaveCount(1);
	});

	test('a query with no matches reads No results and paints nothing', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'zzzznotpresent');
		await expect(count(page)).toHaveText(/No results/);
		await expect(overlays(page)).toHaveCount(0);
	});

	test('a regex matching empty paints no zero-width overlay sliver', async ({ page }) => {
		await openFind(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		// `a*` matches each `a` run AND the empty string at every other position; the
		// empty matches measure zero-width and must be dropped, not painted.
		await typeQuery(editor, 'a*');
		await expect(overlays(page).first()).toBeVisible();
		const widths = await overlays(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().width)
		);
		expect(widths.length).toBeGreaterThan(0);
		expect(widths.every((w) => w > 0)).toBe(true);
	});
});

test.describe('search — navigation', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha one\n\nalpha two\n\nalpha three\n');
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
	});

	test('Enter advances to the next match and wraps at the end', async ({ page }) => {
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/2\s*\/\s*3/);
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/3\s*\/\s*3/);
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
	});

	test('Shift+Enter steps to the previous match and wraps at the start', async ({ page }) => {
		await page.keyboard.press('Shift+Enter');
		await expect(count(page)).toHaveText(/3\s*\/\s*3/);
		await page.keyboard.press('Shift+Enter');
		await expect(count(page)).toHaveText(/2\s*\/\s*3/);
	});

	test('exactly one overlay is active after navigating', async ({ page }) => {
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/2\s*\/\s*3/);
		await expect(activeOverlays(page)).toHaveCount(1);
	});
});

test.describe('search — edit while open', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('editing the document while the bar is open re-scans the count', async ({ page }) => {
		await editor.loadContent('alpha beta\n');
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);

		// Real edit: focus the block and type another occurrence. The bar's
		// open-state rescan should pick it up.
		await editor.focusBlockEnd(0);
		await editor.typeText(' alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
	});
});

test.describe('search — bar stays pinned', () => {
	// Regression: the bar was absolutely positioned inside the scroll container, so
	// navigating to an off-screen match scrolled it out of view. A zero-height
	// sticky anchor now pins it to the scrollport top.
	test('the bar remains in the editor viewport after Next scrolls to an off-screen match', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		// Needle at the top and far below; filler between forces a scroll when
		// navigating from the first match to the second.
		const filler = Array.from({ length: 80 }, (_, i) => `filler paragraph ${i}`).join('\n\n');
		await editor.loadContent(`needle top\n\n${filler}\n\nneedle bottom\n`);

		await openFind(editor);
		await typeQuery(editor, 'needle');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);

		const barPlacement = () =>
			page.evaluate(() => {
				const ed = document.querySelector('.editor')!.getBoundingClientRect();
				const bar = document.querySelector('.search-bar')?.getBoundingClientRect();
				if (!bar) return null;
				return {
					pinnedToTop: bar.top >= ed.top - 2,
					inViewport: bar.bottom > ed.top && bar.top < ed.bottom,
					barTop: Math.round(bar.top),
					edTop: Math.round(ed.top)
				};
			});

		const before = await barPlacement();
		expect(before, 'search bar must exist').not.toBeNull();
		expect(before!.pinnedToTop && before!.inViewport).toBe(true);

		// Navigate to the off-screen match; the editor scrolls down to reveal it.
		await page.getByRole('button', { name: 'Next match' }).click();
		await expect(count(page)).toHaveText(/2\s*\/\s*2/);
		// Guard against a vacuous pass: if a future viewport change stops the doc
		// from overflowing, Next scrolls nothing and "bar stayed at top" is trivially
		// true. Assert the reveal actually scrolled the editor.
		await expect
			.poll(() => page.evaluate(() => document.querySelector('.editor')!.scrollTop))
			.toBeGreaterThan(0);
		await expect.poll(async () => (await barPlacement())?.inViewport).toBe(true);

		const after = await barPlacement();
		expect(
			after!.pinnedToTop,
			`bar.top=${after!.barTop} drifted from editor.top=${after!.edTop} — it scrolled away`
		).toBe(true);
	});
});

test.describe('search — off-window reveal', () => {
	test('navigating to an off-window match scrolls its block into view', async ({ page }) => {
		const pageErrors = capturePageErrors(page);

		const editor = new EditorPage(page);
		await editor.goto();
		// A multi-MB fixture activates windowing; the suffix appends a paragraph
		// holding a unique marker as the LAST (off-window) block. The fixture's
		// 16-word vocabulary never contains the marker, so it is the sole match.
		await editor.loadLargeFixture('many-small-blocks', 2_000_000, '\n\nZZUNIQUEMARKER tail\n');

		const blockCount = await page.evaluate(
			() => (window as any).__test.getDocument().children.length
		);
		const last = blockCount - 1;

		// Precondition: windowing is active and the marker block is genuinely
		// off-window, or the reveal assertion is vacuous.
		expect(await page.locator('.vr-spacer').count()).toBeGreaterThan(0);
		expect(
			await page.evaluate(
				(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
				last
			)
		).toBe(false);

		await openFind(editor);
		await page.keyboard.type('ZZUNIQUEMARKER');
		await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*1/);

		// Enter navigates to the (only) match and reveals it.
		await page.keyboard.press('Enter');
		await page.waitForFunction(
			(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
			last,
			{ timeout: 10_000, polling: 16 }
		);
		expect(
			await page.evaluate(
				(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
				last
			)
		).toBe(true);
		expect(pageErrors).toEqual([]);
	});
});
