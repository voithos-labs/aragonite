import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { textRunRect } from '../../text-runs';

/**
 * Decoration mark overlay (requirements/decorations/mark-overlay.md). Sources register through
 * the public registry via the e2e bridge, needing no plugin, and the find bar paints on this
 * same overlay under the source name `editor:search`.
 */

test.describe('decoration mark overlay', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a mark paints one overlay carrying the source class over its painted word', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-static',
				provide: () => [{ type: 'mark', path: [0], start: 0, end: 5, class: 'e2e-mark' }]
			});
		});

		const overlay = page.locator('.decoration-overlay.e2e-mark');
		await expect(overlay).toHaveCount(1);
		const box = (await overlay.boundingBox())!;
		const word = await textRunRect(page, 'hello', { path: [0] });
		expect([box.x, box.x + box.width]).toEqual([
			expect.closeTo(word.left, 0),
			expect.closeTo(word.right, 0)
		]);
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

	test('two marks in one table cell paint two overlays, each over its own word', async ({
		page
	}) => {
		await editor.loadContent('| Name | Role |\n| :--- | :--- |\n| Ada Lovelace | dev |\n');
		// Body cell "Ada Lovelace" is table → row 1 (header is row 0) → col 0.
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-cell',
				provide: () => [
					{ type: 'mark', path: [0, 1, 0], start: 0, end: 3, class: 'e2e-cell' },
					{ type: 'mark', path: [0, 1, 0], start: 4, end: 12, class: 'e2e-cell' }
				]
			});
		});

		const overlays = page.locator('.decoration-overlay.e2e-cell');
		await expect(overlays).toHaveCount(2);
		const boxes = await overlays.evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.right])
		);
		for (const [i, word] of ['Ada', 'Lovelace'].entries()) {
			const run = await textRunRect(page, word, { path: [0, 1, 0] });
			expect(boxes[i]).toEqual([expect.closeTo(run.left, 0), expect.closeTo(run.right, 0)]);
		}
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

		// The re-measured range crosses the dimmed marker and may split into one rect per
		// fragment, so "repaints correctly" means the overlay survives, not that the count matches.
		await editor.focusBlockStart(0);
		await editor.typeSlowly('# ');
		await page.waitForFunction(() => (window as any).__test.getBlockKind(0) === 'heading', null, {
			timeout: 5000,
			polling: 16
		});
		await expect
			.poll(() => page.locator('.decoration-overlay.e2e-kind').count())
			.toBeGreaterThan(0);
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
