import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// An image-only paragraph is a vertical STOP because it can be entered as an object: one press
// selects the image, the next moves on. Requirements: e2e/requirements/blocks/image/caret-arrows-vertical.md.

const STANDALONE_IMAGE_DOC =
	'before paragraph.\n\n![pic](/test-fixtures/sample.png)\n\nafter paragraph.\n';

const LIST_IMAGE_DOC =
	'above list paragraph.\n\n- ![pic](/test-fixtures/sample.png)\n- second item text\n';

const LIST_IMAGE_LAST_DOC =
	'- first item text\n- ![pic](/test-fixtures/sample.png)\n\nbelow list paragraph.\n';

/** One arrow onto the image (which selects it), then one past it. The typed X proves where the
 *  second press landed; the overlay proves the first one stopped rather than passing through. */
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

	// Regression: the caret got stuck inside an image-only first list item.
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

	// Regression: the caret was invisible when landing at the image-only paragraph, which is why
	// the stop is a widget SELECTION rather than a caret seat.
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
