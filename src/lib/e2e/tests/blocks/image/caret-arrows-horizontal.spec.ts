import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { enterPresentationMode } from '../../presentation/helpers';

const STANDALONE_IMAGE_DOC =
	'before paragraph.\n\n![pic](/test-fixtures/sample.png)\n\nafter paragraph.\n';

const INLINE_IMAGE_DOC = 'lead text ![pic](/test-fixtures/sample.png) trail text\n';

test.describe('horizontal arrow traversal around image widgets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowLeft from below a standalone image: press 1 selects, press 2 lands above', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockStart(2);
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toContain('before paragraph.X');
	});

	test('ArrowRight from above a standalone image: press 1 selects, press 2 lands below', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toContain('Xafter paragraph');
	});

	test('ArrowLeft from after an inline image: select then land at end of preceding text', async ({
		page
	}) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await page.evaluate(() => {
			const w = document.querySelector('[data-image-widget]');
			if (!w) throw new Error('widget not found');
			const para = w.closest('[contenteditable="true"]') as HTMLElement;
			para.focus();
			const range = document.createRange();
			const parent = w.parentNode!;
			const idx = Array.prototype.indexOf.call(parent.childNodes, w);
			range.setStart(parent, idx + 1);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		// Trailing whitespace from "lead text " may sit on either side of X, hence the loose match.
		expect(src).toMatch(/lead text\s*X\s*!\[pic\]/);
	});

	// The hidden source span must not attract the caret when `focusAtColumn` arrives from elsewhere.
	test('cross-block ArrowUp landing on standalone image leaves a visible caret', async ({
		page
	}) => {
		await editor.loadContent(
			'first paragraph text.\n\n![pic|400x200](/test-fixtures/sample.png)\n'
		);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		// One ArrowDown reaches the image paragraph; a vertical move passes over it, and past the
		// last block a new paragraph may be created.
		await page.keyboard.press('ArrowUp');
		// The real assertion: no step left a caret inside the widget's hidden source span, verified
		// by typing and reading the source back.
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		// The X must land in real text, not spliced into the image's source bytes.
		expect(src).not.toMatch(/!\[.*X.*\]/);
		expect(src).not.toMatch(/X.*\(\/test-fixtures/);
	});
});

test.describe('live mode: horizontal arrows onto a picture inside a link', () => {
	// Live mode hides the link's markers, so the picture is the first and last thing its block draws.
	for (const [key, from, at] of [
		['ArrowRight', 0, 4],
		['ArrowLeft', 2, 0]
	] as const) {
		test(`${key} selects the picture, and a key typed then replaces it`, async ({ page }) => {
			const editor = await enterPresentationMode(
				page,
				'live',
				'text\n\n[![cat|120x80](/test-fixtures/sample.png)](https://x)\n\nend\n'
			);
			await page.waitForFunction(
				() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
			);
			await editor.focusBlockAtPath([from], at);

			await page.keyboard.press(key);
			await expect(page.locator('[data-image-overlay]')).toHaveCount(1);
			await editor.typeText('Q');

			await editor.bridge.waitForSourceEquals('text\n\n[Q](https://x)\n\nend\n');
		});
	}
});
