import type { Page } from '@playwright/test';
import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

/** Each drawn box's size, in document order. */
const paintedBoxes = (page: Page): Promise<Array<{ width: string; height: string }>> =>
	page.evaluate(() =>
		Array.from(document.querySelectorAll('.task-checkbox')).map((el) => {
			const box = getComputedStyle(el, '::before');
			return { width: box.width, height: box.height };
		})
	);

// The rendered box once centred itself with translate(-50%, -50%). A transformed box is
// rasterised at its fractional edges, so on a scaled desktop (limestone on a Windows 150%
// display) one edge came out half-painted and the square read visibly shorter than wide. The
// harness runs at scale 1, where the same box looked fine; this lane runs at the scale that
// showed it. The guard is the mechanism: no transform, and a whole-pixel size that snaps the
// same way on both axes.
test.describe('task checkbox — painted box geometry', () => {
	test.use({ deviceScaleFactor: 1.5 });

	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
	});

	for (const fontSize of [14, 16, 17]) {
		test(`the box is a whole-pixel square, centred by layout, at ${fontSize}px`, async ({
			page
		}) => {
			await editor.loadContent('- [x] done\n- [ ] open\n');
			// The type-scale root the box sizes off: an inline `font-size` on the editor root moves
			// the text and leaves the box where it was.
			await page.evaluate((px) => {
				document
					.querySelector<HTMLElement>('.editor')!
					.style.setProperty('--editor-font-size', `${px}px`);
			}, fontSize);
			const boxes = await page.evaluate(() =>
				Array.from(document.querySelectorAll('.task-checkbox')).map((el) => {
					const s = getComputedStyle(el, '::before');
					return { width: s.width, height: s.height, transform: s.transform };
				})
			);
			expect(boxes).toHaveLength(2);
			for (const box of boxes) {
				expect(box.transform).toBe('none');
				expect(box.width).toBe(box.height);
				expect(box.width).toMatch(/^\d+px$/);
			}
		});
	}

	// Non-vacuity for the loop above, whose assertions are size-agnostic: they hold even if the
	// box stops answering the type-scale root at all.
	test('the drawn box follows the type-scale root', async ({ page }) => {
		await editor.loadContent('- [ ] open\n');
		const widths: string[] = [];
		for (const fontSize of [14, 16, 17]) {
			await page.evaluate((px) => {
				document
					.querySelector<HTMLElement>('.editor')!
					.style.setProperty('--editor-font-size', `${px}px`);
			}, fontSize);
			widths.push((await paintedBoxes(page))[0].width);
		}
		expect(new Set(widths).size).toBe(widths.length);
	});

	// The box is the item's own chrome, so it draws at the item's text size whatever its first
	// block turns out to be. Sized in `em` against that block, a loaded heading doubled it.
	test('the box beside a loaded heading matches the box beside a paragraph', async ({ page }) => {
		await editor.loadContent('- [ ] # beta\n- [ ] plain\n');
		const boxes = await paintedBoxes(page);
		expect(boxes).toHaveLength(2);
		expect(boxes[0]).toEqual(boxes[1]);
	});

	test('every heading level keeps the paragraph-sized box', async ({ page }) => {
		const levels = [1, 2, 3, 4, 5, 6];
		await editor.loadContent(
			`${levels.map((n) => `- [ ] ${'#'.repeat(n)} head\n`).join('')}- [ ] plain\n`
		);
		const boxes = await paintedBoxes(page);
		expect(boxes).toHaveLength(levels.length + 1);
		expect(boxes).toEqual(boxes.map(() => boxes[boxes.length - 1]));
	});

	// The span is a line-height-tall slot; the source-mode hover tint on it drew a tall
	// rectangle round the square. In the rendered modes the tint belongs to the box alone.
	test('hovering tints the box, not the slot around it', async ({ page }) => {
		await editor.loadContent('- [ ] open\n- [x] done\n');
		const open = page.locator('.task-checkbox').first();
		await open.hover();
		await expect
			.poll(() =>
				page.evaluate(() => {
					const el = document.querySelector('.task-checkbox')!;
					return {
						span: getComputedStyle(el).backgroundColor,
						box: getComputedStyle(el, '::before').backgroundColor
					};
				})
			)
			.toEqual({ span: 'rgba(0, 0, 0, 0)', box: 'rgba(128, 128, 128, 0.15)' });
	});
});
