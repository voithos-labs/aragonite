import { test, expect } from '../fixtures';
import { waitForEditorHydrated } from '../page-probes';
import { SHOWCASE_MD, scanShowcase } from '../showcase-document';

// The `/` showcase header: theme, drag handles, the debug panel, and the table of contents as
// navigation. This route has no `window.__test` bridge, so the cases read rendered DOM only.
// The mode toggle and the bundled plugins have their own specs. What the demo document says is
// read from its bytes, never written out here, since it is rewritten by hand.
// Requirements: e2e/requirements/showcase-chrome.md.

test.describe('/ showcase chrome', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// One storage key holds the panel's state on both routes that mount it, so "closed by
		// default" below only holds by luck until the key is cleared.
		await page.evaluate(() => localStorage.removeItem('aragonite.debug-panel.state.v1'));
		await page.reload();
		await waitForEditorHydrated(page);
	});

	test('seeds the demo document with a live outline', async ({ page }) => {
		const [opening] = scanShowcase().headings;
		expect(opening, 'the demo document opens with no heading').toBeDefined();
		await expect(page.locator('[data-block-kind="heading"]').first()).toContainText(opening.text);

		expect(SHOWCASE_MD, 'the demo document asks for no outline').toMatch(/^\[\[toc\]\]\s*$/m);
		await expect(page.locator('.toc-block-item').first()).toBeVisible();
	});

	test('theme toggle flips the editor between light and dark', async ({ page }) => {
		const editor = page.locator('.editor');
		// Light is the showcase's default; the editor's own `theme` default stays dark.
		await expect(editor).toHaveAttribute('data-editor-theme', 'light');

		await page.getByTestId('theme-toggle').click();
		await expect(editor).toHaveAttribute('data-editor-theme', 'dark');

		await page.getByTestId('theme-toggle').click();
		await expect(editor).toHaveAttribute('data-editor-theme', 'light');
	});

	test('drag-handles toggle drops the grips and carries the edit across the remount', async ({
		page
	}) => {
		const handles = page.locator('.block-drag-handle');
		// Handles are on by default, so the showcase opens with them like any default embed.
		await expect.poll(() => handles.count()).toBeGreaterThan(0);

		// The prop is read once, so the toggle remounts the editor; an edit made beforehand is
		// the only way to see whether the route carried the current source across.
		const intro = page.locator('.block-host [contenteditable]').first();
		await intro.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' ZZMARKER');
		await expect(intro).toContainText('ZZMARKER');

		await page.getByTestId('drag-handles-toggle').click();
		// Not zero: an image's own handle does not answer to the toggle.
		await expect
			.poll(() =>
				page.locator('.block-host:not([data-block-kind="paragraph"]) .block-drag-handle').count()
			)
			.toBe(0);
		await expect(page.locator('.editor')).toContainText('ZZMARKER');

		await page.getByTestId('drag-handles-toggle').click();
		await expect.poll(() => handles.count()).toBeGreaterThan(0);
	});

	test('reading mode disables the drag-handles toggle', async ({ page }) => {
		const toggle = page.getByTestId('drag-handles-toggle');
		await expect(toggle).toBeEnabled();

		// The editor turns drag handles off in reading mode; a toggle that stayed enabled would
		// look active while doing nothing.
		await page.locator('.showcase-mode[data-mode="reading"]').click();
		await expect(toggle).toBeDisabled();
	});

	test('hotkey opens the debug panel and the header affordance closes it', async ({ page }) => {
		const panel = page.locator('.debug-panel');
		await expect(panel).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+Shift+D');
		await expect(panel).toBeVisible();
		// The panel is what shows the editor's inner workings, so its tree section must show the
		// showcase document's own tree, not an empty or stale one.
		await expect(
			panel.locator('.debug-section[data-section-title="CST tree"] .debug-section-body')
		).toContainText('heading');

		await page.getByTestId('debug-toggle').click();
		await expect(panel).toHaveCount(0);
	});

	test('selecting text in live mode floats the toolbar and its bold button wraps the run', async ({
		page
	}) => {
		const toolbar = page.getByTestId('selection-toolbar');
		// Both toolbars belong to live mode, which the showcase opens in: a markdown-first mode
		// mounts neither, and switching back brings the strip in once something is selected.
		await expect(page.getByTestId('insert-toolbar')).toHaveCount(1);
		await page.locator('.showcase-mode[data-mode="source"]').click();
		await expect(toolbar).toHaveCount(0);
		await expect(page.getByTestId('insert-toolbar')).toHaveCount(0);
		await page.locator('.showcase-mode[data-mode="live"]').click();
		await expect(page.getByTestId('insert-toolbar')).toHaveCount(1);

		const intro = page.locator('.block-host [contenteditable]').first();
		await intro.click();
		await page.keyboard.press('Home');
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(toolbar).toBeVisible();

		// The first line sits right under the header, so the bar cannot fit above the selection
		// within the top inset the showcase passes: it moves below instead of onto the header.
		const bar = await toolbar.boundingBox();
		const header = await page.locator('.showcase-header').boundingBox();
		expect(bar!.y).toBeGreaterThan(header!.y + header!.height);

		await page.getByTestId('toolbar-format.toggleStrong').click();
		// Live mode shows no markers, so the wrap shows up as bold text itself.
		await expect(intro.locator('strong').first()).toBeVisible();

		// A plain arrow collapses the selection, which is the bar's hide signal.
		await page.keyboard.press('ArrowRight');
		await expect(toolbar).toHaveCount(0);
	});

	test('the insert strip mints a table once the live document holds a caret', async ({ page }) => {
		await page.locator('.showcase-mode[data-mode="live"]').click();
		const table = page.getByTestId('insert-table');
		await expect(table).toBeDisabled();

		await page.locator('.block-host [contenteditable]').first().click();
		await expect(table).toBeEnabled();

		await table.click();
		await expect(page.locator('.table-block').first()).toBeVisible();
	});

	test('clicking a toc entry scrolls the editor to that heading', async ({ page }) => {
		const editor = page.locator('.editor');
		expect(await editor.evaluate((el) => el.scrollTop)).toBe(0);

		// The last entry, so the jump is unmistakable whichever sections the document holds.
		await page.locator('.toc-block-item').last().click();

		await expect.poll(() => editor.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	});

	test('the changelog link navigates to the changelog route', async ({ page }) => {
		// `resolve()` under a configured base path: a wrong href lands on a 404 with a URL that
		// still looks plausible, so what the destination page shows is the real check.
		await page.getByRole('link', { name: 'changelog' }).click();
		await expect(page).toHaveURL(/\/changelog\/?$/);
		await expect(page.locator('.changelog-tag')).toBeVisible();
	});
});
