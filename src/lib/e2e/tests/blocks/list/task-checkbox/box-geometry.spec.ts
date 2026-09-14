import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

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
			await page.evaluate((px) => {
				document.querySelector<HTMLElement>('.editor')!.style.fontSize = `${px}px`;
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
