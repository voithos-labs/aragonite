import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * Decoration mark overlay (requirements/decorations/mark-overlay.md). Sources
 * register through the public registry via the e2e bridge — no plugin needed —
 * and `DecorationOverlay` paints a positioned div per mark, carrying the
 * source's class. The find bar now rides this same overlay (source
 * `editor:search`).
 */

test.describe('decoration mark overlay', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a mark paints one overlay carrying the source class over its range', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-static',
				provide: () => [{ type: 'mark', path: [0], start: 0, end: 5, class: 'e2e-mark' }]
			});
		});

		const overlay = page.locator('.decoration-overlay.e2e-mark');
		await expect(overlay).toHaveCount(1);
		const box = await overlay.boundingBox();
		expect(box!.width).toBeGreaterThan(0);
	});

	test('a mark spanning a soft-wrapped range paints one rect per visual line', async ({ page }) => {
		const line = 'word '.repeat(120).trim();
		await editor.loadContent(`${line}\n`);
		await page.evaluate((end) => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-span',
				provide: () => [{ type: 'mark', path: [0], start: 0, end, class: 'e2e-span' }]
			});
		}, line.length);

		const overlays = page.locator('.decoration-overlay.e2e-span');
		await expect.poll(() => overlays.count()).toBeGreaterThanOrEqual(2);
		const widths = await overlays.evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().width)
		);
		expect(widths.every((w) => w > 0)).toBe(true);
	});

	test('a mark on a table cell paints one whole-cell overlay', async ({ page }) => {
		await editor.loadContent('| Name | Role |\n| :--- | :--- |\n| Ada | dev |\n');
		// Body cell "Ada" is table → row 1 (header is row 0) → col 0.
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-cell',
				provide: () => [{ type: 'mark', path: [0, 1, 0], start: 0, end: 3, class: 'e2e-cell' }]
			});
		});

		await expect(page.locator('.decoration-overlay.e2e-cell')).toHaveCount(1);
		await expect(page.locator('.decoration-overlay.e2e-cell')).toBeVisible();
	});

	test('an interactive mark receives a real click', async ({ page }) => {
		await editor.loadContent('click me here\n');
		await page.evaluate(() => {
			(window as any).__test._clicks = 0;
			(window as any).__test.decorations.addSource({
				name: 'e2e-interactive',
				provide: () => [
					{
						type: 'mark',
						path: [0],
						start: 0,
						end: 5,
						class: 'e2e-click',
						interactive: {
							onClick: () => {
								(window as any).__test._clicks++;
							}
						}
					}
				]
			});
		});

		const overlay = page.locator('.decoration-overlay.e2e-click');
		await expect(overlay).toHaveCount(1);
		await overlay.click();
		await expect.poll(() => page.evaluate(() => (window as any).__test._clicks)).toBe(1);
	});

	test('a document-tracking source repaints after an edit adds an occurrence', async ({ page }) => {
		await editor.loadContent('cat one\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-cats',
				provide: (doc: { children: { raw?: string }[] }) => {
					const raw = doc.children[0]?.raw ?? '';
					const out: unknown[] = [];
					for (let i = raw.indexOf('cat'); i !== -1; i = raw.indexOf('cat', i + 3)) {
						out.push({ type: 'mark', path: [0], start: i, end: i + 3, class: 'e2e-cat' });
					}
					return out;
				}
			});
		});
		await expect(page.locator('.decoration-overlay.e2e-cat')).toHaveCount(1);

		await editor.focusBlockEnd(0);
		await editor.typeText(' cat');
		await expect(page.locator('.decoration-overlay.e2e-cat')).toHaveCount(2);
	});

	test('a marked block keeps its overlay when its kind changes', async ({ page }) => {
		await editor.loadContent('title text\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-kind',
				provide: (doc: { children: { raw?: string }[] }) =>
					(doc.children[0]?.raw ?? '').includes('title')
						? [{ type: 'mark', path: [0], start: 0, end: 5, class: 'e2e-kind' }]
						: []
			});
		});
		await expect(page.locator('.decoration-overlay.e2e-kind')).toHaveCount(1);

		// `# ` at the start turns the paragraph into a heading; the overlay re-measures
		// and still paints. (Its range now crosses the dimmed `# ` marker, so it can
		// split into per-fragment rects — the survival, not the fragment count, is
		// what "repaints correctly" means here.)
		await editor.focusBlockStart(0);
		await editor.typeSlowly('# ');
		await page.waitForFunction(() => (window as any).__test.getBlockKind(0) === 'heading', null, {
			timeout: 2000,
			polling: 16
		});
		await expect
			.poll(() => page.locator('.decoration-overlay.e2e-kind').count())
			.toBeGreaterThan(0);
	});

	test('a mark still paints after flipping to reading mode (decorations are view-only)', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-reading',
				provide: () => [{ type: 'mark', path: [0], start: 0, end: 5, class: 'e2e-reading' }]
			});
		});
		await expect(page.locator('.decoration-overlay.e2e-reading')).toHaveCount(1);

		// Reading makes the surface inert (no caret), but a view-only decoration is not
		// caret-driven — it must still paint over its range in the read-only view.
		await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
		await expect(page.locator('.decoration-overlay.e2e-reading')).toHaveCount(1);
	});

	test('disposing the source unpaints its overlays', async ({ page }) => {
		await editor.loadContent('bye now\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-dispose',
				provide: () => [{ type: 'mark', path: [0], start: 0, end: 3, class: 'e2e-dispose' }]
			});
		});
		await expect(page.locator('.decoration-overlay.e2e-dispose')).toHaveCount(1);

		await page.evaluate(() => (window as any).__test.decorations.disposeSource('e2e-dispose'));
		await expect(page.locator('.decoration-overlay.e2e-dispose')).toHaveCount(0);
	});
});
