import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// What a host reads while an image is selected whole: the browser puts a caret back at the
// paragraph's start on the next key, and the editor drops it a moment later.
test.describe('reading the selection while an image is selected', () => {
	const IMAGE = '![c|60x40](/test-fixtures/sample.png)';
	const imageEnd = { path: [0], offset: 'abc '.length + IMAGE.length };

	test("a host's keydown handler reads the image's end, never the paragraph start", async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(`abc ${IMAGE} tail\n`);
		await editor.focusBlock(0, 2);
		await page.locator('[data-image-widget]').first().click();
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		// Read inside the host's own handler, before the editor drops the browser's caret.
		await page.evaluate(() => {
			const w = window as any;
			w.__keydownReads = [];
			document.addEventListener('keydown', () => w.__keydownReads.push(w.__test.getSelection()), {
				capture: true,
				once: true
			});
			w.__test.startSelectionChangeCapture();
		});

		await page.keyboard.press('ArrowRight');

		const read = await page.evaluate(() => (window as any).__keydownReads[0]);
		expect(read).toEqual({ anchor: imageEnd, focus: imageEnd });
		const emitted = await page.evaluate(() => (window as any).__test.stopSelectionChangeCapture());
		expect(emitted.map((e: { focus: { offset: number } | null }) => e.focus?.offset)).not.toContain(
			0
		);
	});
});
