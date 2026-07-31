import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const STANDALONE_IMAGE_DOC =
	'before paragraph.\n\n![pic](/test-fixtures/sample.png)\n\nafter paragraph.\n';

const LIST_IMAGE_DOC =
	'above list paragraph.\n\n- ![pic](/test-fixtures/sample.png)\n- second item text\n';

const LIST_IMAGE_LAST_DOC =
	'- first item text\n- ![pic](/test-fixtures/sample.png)\n\nbelow list paragraph.\n';

test.describe('vertical arrow traversal around image widgets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Regression: the caret got stuck inside an image-only first list item.
	test('ArrowUp from a list item below an image-only list item skips out of the list', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await editor.focusBlockAtPath([1, 1, 0], 0);
		await page.keyboard.press('ArrowUp');
		// The marker must land in the "above list paragraph" line, not in the image's list-item
		// content.
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*above list paragraph|above list paragraph.*X|abXove|abovXe/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	test('ArrowDown from above an image-only-first list-item lands in the second item', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*second item text|second item text.*X|seconXd|secondX item/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	test('ArrowUp from below an image-only-last list-item lands in the penultimate item', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_LAST_DOC);
		await editor.focusBlockStart(1);
		await page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*first item text|first item text.*X|firXst|firstX item/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	// Regression: the caret was invisible when landing at the image-only paragraph.
	test('ArrowUp from below a standalone image skips the image paragraph in one press', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockStart(2);
		await page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*before paragraph|before.*paragraphX/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});

	test('ArrowDown from above a standalone image skips the image paragraph in one press', async ({
		page
	}) => {
		await editor.loadContent(STANDALONE_IMAGE_DOC);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/X.*after paragraph|after paragraph.*X/);
		expect(src).not.toMatch(/!\[pic.*X|X.*\(\/test-fixtures/);
	});
});
