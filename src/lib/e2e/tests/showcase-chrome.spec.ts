import { test, expect } from '../fixtures';
import { waitForEditorHydrated } from '../page-probes';

// The `/` showcase header: theme, drag handles, the debug panel, and the toc as navigation.
// No `window.__test` bridge on this route, so assertions read rendered DOM only. The mode
// toggle and the bundled-plugin surface have their own specs and are not re-tested here.
// Requirements: e2e/requirements/showcase-chrome.md.

test.describe('/ showcase chrome', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// One storage key backs the panel on both mounting routes, so the closed-by-default
		// premise below is a fresh-context accident until it is cleared explicitly.
		await page.evaluate(() => localStorage.removeItem('aragonite.debug-panel.state.v1'));
		await page.reload();
		await waitForEditorHydrated(page);
	});

	test('seeds the pitch document with a live outline', async ({ page }) => {
		await expect(page.locator('.editor')).toContainText('serialize(parse(source)) === source');
		// The outline is derived from the document's own headings, so entries at more than
		// one level prove it walked the sections rather than rendering a placeholder.
		await expect(page.locator('.toc-block-item', { hasText: 'Math' })).toBeVisible();
		await expect(page.locator('.toc-block-item.toc-block-level-3').first()).toBeVisible();
	});

	test('theme toggle flips the editor between dark and light', async ({ page }) => {
		const editor = page.locator('.editor');
		await expect(editor).toHaveAttribute('data-editor-theme', 'dark');

		await page.getByTestId('theme-toggle').click();
		await expect(editor).toHaveAttribute('data-editor-theme', 'light');

		await page.getByTestId('theme-toggle').click();
		await expect(editor).toHaveAttribute('data-editor-theme', 'dark');
	});

	test('drag-handles toggle adds the grips and carries the edit across the remount', async ({
		page
	}) => {
		const handles = page.locator('.block-drag-handle');
		// Handles are opt-in, so the showcase opens gutter-free like any default embed.
		await expect(handles).toHaveCount(0);

		// The prop is set-once, so the toggle remounts the editor — an edit made first is
		// the only thing that can show whether the route carried the live source across.
		const intro = page.locator('.block-host [contenteditable]').first();
		await intro.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' ZZMARKER');
		await expect(intro).toContainText('ZZMARKER');

		await page.getByTestId('drag-handles-toggle').click();
		await expect.poll(() => handles.count()).toBeGreaterThan(0);
		await expect(page.locator('.editor')).toContainText('ZZMARKER');

		await page.getByTestId('drag-handles-toggle').click();
		await expect(handles).toHaveCount(0);
	});

	test('reading mode disables the drag-handles toggle', async ({ page }) => {
		const toggle = page.getByTestId('drag-handles-toggle');
		await expect(toggle).toBeEnabled();

		// The editor gates handles off in reading mode; a live toggle would paint active
		// while producing nothing.
		await page.locator('.showcase-mode[data-mode="reading"]').click();
		await expect(toggle).toBeDisabled();
	});

	test('hotkey opens the debug panel and the header affordance closes it', async ({ page }) => {
		const panel = page.locator('.debug-panel');
		await expect(panel).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+Shift+D');
		await expect(panel).toBeVisible();
		// The panel is the "under the hood" pitch element: its CST section must show the
		// showcase document's own tree, not an empty or stale one.
		await expect(
			panel.locator('.debug-section[data-section-title="CST tree"] .debug-section-body')
		).toContainText('heading');

		await page.getByTestId('debug-toggle').click();
		await expect(panel).toHaveCount(0);
	});

	test('selecting text floats the toolbar and its bold button wraps the run', async ({ page }) => {
		const toolbar = page.getByTestId('selection-toolbar');
		await expect(toolbar).toHaveCount(0);

		const intro = page.locator('.block-host [contenteditable]').first();
		await intro.click();
		await page.keyboard.press('Home');
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(toolbar).toBeVisible();

		// The first line sits right under the header, so the bar cannot clear the topInset the
		// showcase passes: it flips below the selection instead of landing on the header.
		const bar = await toolbar.boundingBox();
		const header = await page.locator('.showcase-header').boundingBox();
		expect(bar!.y).toBeGreaterThan(header!.y + header!.height);

		await page.getByTestId('toolbar-format.toggleStrong').click();
		await expect(intro).toContainText('**');

		// A plain arrow collapses the selection, which is the bar's hide signal.
		await page.keyboard.press('ArrowRight');
		await expect(toolbar).toHaveCount(0);
	});

	test('clicking a toc entry scrolls the editor to that heading', async ({ page }) => {
		const editor = page.locator('.editor');
		expect(await editor.evaluate((el) => el.scrollTop)).toBe(0);

		await page.locator('.toc-block-item', { hasText: 'Emoji' }).click();

		await expect.poll(() => editor.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	});

	test('the changelog link navigates to the changelog route', async ({ page }) => {
		// `resolve()` under a configured base path: a wrong href lands on a 404 with the URL
		// still looking plausible, so the destination's own chrome is the real assertion.
		await page.getByRole('link', { name: 'changelog' }).click();
		await expect(page).toHaveURL(/\/changelog\/?$/);
		await expect(page.locator('.changelog-tag')).toBeVisible();
	});
});
