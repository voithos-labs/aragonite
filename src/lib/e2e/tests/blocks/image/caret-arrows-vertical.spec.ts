import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { activeBlockPath } from '../../plugins/helpers';
import { waitForAllImagesLoaded } from './helpers';
import { enterPresentationMode } from '../../presentation/helpers';

// An image-only paragraph is a vertical stop because it can be entered as an object: one keypress
// selects the image, the next moves on.
// Requirements: `e2e/requirements/blocks/image/caret-arrows-vertical.md`.

const STANDALONE_IMAGE_DOC =
	'before paragraph.\n\n![pic](/test-fixtures/sample.png)\n\nafter paragraph.\n';

const LIST_IMAGE_DOC =
	'above list paragraph.\n\n- ![pic](/test-fixtures/sample.png)\n- second item text\n';

const LIST_IMAGE_LAST_DOC =
	'- first item text\n- ![pic](/test-fixtures/sample.png)\n\nbelow list paragraph.\n';

/** One arrow onto the image (which selects it), then one past it: the typed X proves where the
 *  second landed, the overlay that the first stopped rather than passing through. */
async function stepOverImage(editor: EditorPage, key: 'ArrowUp' | 'ArrowDown'): Promise<string> {
	await editor.page.keyboard.press(key);
	await expect(editor.page.locator('[data-image-overlay]')).toHaveCount(1);
	await editor.page.keyboard.press(key);
	await editor.typeText('X');
	await editor.bridge.waitForSourceContains('X');
	return editor.bridge.getSource();
}

test.describe('vertical arrow traversal around image widgets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The caret must not get stuck inside an image-only first list item.
	test('ArrowUp from a list item below an image-only list item steps out of the list', async () => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await editor.focusBlockAtPath([1, 1, 0], 0);

		const src = await stepOverImage(editor, 'ArrowUp');
		// Anywhere in the paragraph: the column memory picks the offset, and a proportional face
		// maps the item's start to no fixed character of the line above.
		const [first] = src.split('\n');
		expect(first.replace('X', '')).toBe('above list paragraph.');
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	test('ArrowDown from above an image-only-first list-item reaches the second item', async () => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await editor.focusBlockEnd(0);

		const src = await stepOverImage(editor, 'ArrowDown');
		expect(src).toMatch(/X.*second item text|second item text.*X|seconXd|secondX item/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	test('ArrowUp from below an image-only-last list-item reaches the penultimate item', async () => {
		await editor.loadContent(LIST_IMAGE_LAST_DOC);
		await editor.focusBlockStart(1);

		const src = await stepOverImage(editor, 'ArrowUp');
		expect(src).toMatch(/X.*first item text|first item text.*X|firXst|firstX item/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	// A caret landing in the image-only paragraph would be invisible, which is why the stop
	// selects the widget instead of placing a caret.
	test('ArrowUp from below a standalone image selects it, then reaches the paragraph above', async () => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockStart(2);

		const src = await stepOverImage(editor, 'ArrowUp');
		expect(src).toMatch(/X.*before paragraph|before.*paragraphX/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	test('ArrowDown from above a standalone image selects it, then reaches the paragraph below', async () => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockEnd(0);

		const src = await stepOverImage(editor, 'ArrowDown');
		expect(src).toMatch(/X.*after paragraph|after paragraph.*X/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});
});

// Two adjacent images too wide for one line: the paragraph holds no text at all, so its first
// line cannot be found by looking for text.
const WRAPPED_IMAGES_DOC =
	'before paragraph.\n\n![a|500x60](/test-fixtures/sample.png)![b|500x60](/test-fixtures/sample.png)\n\nafter paragraph.\n';

test.describe('vertical arrows inside a wrapped image-only paragraph', () => {
	test('ArrowUp from beside the second-line image stays in the paragraph', async ({ page }) => {
		test.fixme(
			true,
			'#574: Chromium drops the caret beside the trailing image; ArrowUp reads it as raw 0'
		);
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(WRAPPED_IMAGES_DOC);
		await waitForAllImagesLoaded(page);
		const [first, second] = await page.locator('[data-image-widget]').all();
		const [a, b] = [await first.boundingBox(), await second.boundingBox()];
		if (!a || !b) throw new Error('image boxes missing');
		expect(b.y).toBeGreaterThan(a.y + a.height / 2);

		await editor.focusBlockEnd(1);
		await editor.waitForRenderFlush();
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();
		expect(await activeBlockPath(page)).toEqual([1]);
	});
});

// Live mode hides the link's markers, so the picture is the first and last thing its block draws.
const LINKED_IMAGE_DOC = 'text\n\n[![cat|120x80](/test-fixtures/sample.png)](https://x)\n\nend\n';

test.describe('live mode: vertical arrows onto a picture inside a link', () => {
	for (const [key, from] of [
		['ArrowDown', 0],
		['ArrowUp', 2]
	] as const) {
		test(`${key} selects the picture, and a key typed then replaces it`, async ({ page }) => {
			test.fixme(
				true,
				'a vertical arrival asks the block whether it is widget-only, which reads its top-level inlines'
			);
			const editor = await enterPresentationMode(page, 'live', LINKED_IMAGE_DOC);
			await waitForAllImagesLoaded(page);
			await editor.focusBlockAtPath([from], from === 0 ? 4 : 0);

			await page.keyboard.press(key);
			await expect(page.locator('[data-image-overlay]')).toHaveCount(1);
			await editor.typeSlowly('Q');

			await editor.bridge.waitForSourceEquals('text\n\n[Q](https://x)\n\nend\n');
		});
	}
});
