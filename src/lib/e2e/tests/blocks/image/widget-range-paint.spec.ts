import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const INLINE_IMAGE_DOC = 'lead text ![pic](/test-fixtures/sample.png) trail text\n';

test.describe('inline image range-selection highlight', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+arrow across inline image adds md-widget-selected', async ({ page }) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await editor.focusBlockStart(0);
		// "lead text " is 10 chars; jump past it then extend across the widget.
		for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(1);
	});

	test('collapsing the selection removes the highlight', async ({ page }) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await editor.focusBlockStart(0);
		for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(1);

		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(0);
	});

	test('cross-block selection covering the image does not add md-widget-selected', async ({
		page
	}) => {
		await editor.loadContent(
			'before paragraph.\n\nlead ![pic](/test-fixtures/sample.png) trail\n\nafter paragraph.\n'
		);
		await editor.focusBlockEnd(0);
		// Extend down two paragraphs — crosses the image paragraph entirely.
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await expect(page.locator('.selection-overlay')).not.toHaveCount(0);
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(0);
	});

	test('click-selecting the widget does not add md-widget-selected', async ({ page }) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await page.locator('[data-image-widget]').first().click();
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(0);
	});

	test('selected widget renders a visible tint overlay (paints over the image)', async ({
		page
	}) => {
		// The original CSS set background-color on the widget span, but the <img> child fully
		// covers it; the tint paints via an ::after with position:absolute;inset:0 so it sits ON
		// TOP of the image.
		await editor.loadContent(INLINE_IMAGE_DOC);
		await editor.focusBlockStart(0);
		for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator('[data-inline-widget].md-widget-selected')).toHaveCount(1);

		const overlay = await page.evaluate(() => {
			const w = document.querySelector('[data-inline-widget].md-widget-selected') as HTMLElement;
			if (!w) return null;
			const after = window.getComputedStyle(w, '::after');
			return {
				content: after.content,
				position: after.position,
				background: after.backgroundColor,
				inset: `${after.top} ${after.right} ${after.bottom} ${after.left}`
			};
		});
		expect(overlay).not.toBeNull();
		// A widget tinted via `background-color` on the span itself would fail here — the image
		// covers the span's background.
		expect(overlay!.content).not.toBe('none');
		expect(overlay!.position).toBe('absolute');
		// Compared against the token painted on a probe, not a hex: the wash derives from
		// --color-selection, so a palette edit must not turn this red.
		const wash = await page.evaluate(() => {
			const probe = document.createElement('div');
			document.querySelector('.editor')!.appendChild(probe);
			probe.style.backgroundColor = 'var(--selection-overlay-bg)';
			const used = getComputedStyle(probe).backgroundColor;
			probe.remove();
			return used;
		});
		expect(overlay!.background).toBe(wash);
	});
});
