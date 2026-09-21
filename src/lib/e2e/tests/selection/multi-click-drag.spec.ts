import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import {
	editorSelection,
	gutterLeftOf,
	markerCenterOf,
	multiClickDrag,
	nativeSelectionText,
	pastLineEnd,
	runCenter
} from './multi-click-helpers';

// Triple-click and the drags a multi-click starts
// (`requirements/selection/multi-click-drag.md`). Cross-block ranges are read from the editor's
// own endpoints: the native range is blank there.

const THREE = 'alpha beta gamma\n\nsecond para here\n\nthird one\n';

test.describe('multi-click: the block rung and drags', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(THREE);
	});

	test('a triple-click selects the paragraph it lands in', async ({ page }) => {
		const at = await runCenter(page, 'para');
		await page.mouse.click(at.x, at.y, { clickCount: 3 });
		await expect.poll(() => nativeSelectionText(page)).toBe('second para here');
	});

	// The browser puts a caret down on the release of a press that landed on no glyph, over
	// whatever range the press painted; the click handling cancels that release.
	test('a triple-click past the end of a line still selects the paragraph', async ({ page }) => {
		const at = await pastLineEnd(page, 'gamma');
		await page.mouse.click(at.x, at.y, { clickCount: 3 });
		await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
		await page.waitForTimeout(150);
		await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
	});

	test("a triple-click in a quote's gutter selects the quoted paragraph", async ({ page }) => {
		await editor.loadContent('alpha beta gamma\n\n> quoted words here\n');
		const at = await gutterLeftOf(page, 'quoted');
		await page.mouse.click(at.x, at.y, { clickCount: 3 });
		await expect.poll(() => nativeSelectionText(page)).toBe('quoted words here');
	});

	test("a double-click on a list item's marker takes the word beside it", async ({ page }) => {
		await editor.loadContent('- item one here\n- item two\n');
		const at = await markerCenterOf(page, 'item one');
		await page.mouse.dblclick(at.x, at.y);
		await expect.poll(() => nativeSelectionText(page)).toBe('item');
	});

	test('a word-drag forward within the block grows a word at a time', async ({ page }) => {
		await multiClickDrag(page, await runCenter(page, 'alpha'), await runCenter(page, 'gamma'), 2);
		await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
	});

	test('a word-drag backward within the block keeps the pressed word', async ({ page }) => {
		await multiClickDrag(page, await runCenter(page, 'gamma'), await runCenter(page, 'alpha'), 2);
		await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
	});

	test('a word-drag into the next paragraph ends at the end of the word under the pointer', async ({
		page
	}) => {
		await multiClickDrag(page, await runCenter(page, 'beta'), await runCenter(page, 'para'), 2);
		await expect
			.poll(() => editorSelection(page))
			.toEqual({
				anchor: { path: [0], offset: 6 },
				focus: { path: [1], offset: 11 }
			});
	});

	test('a word-drag into the previous paragraph starts at the start of that word', async ({
		page
	}) => {
		await multiClickDrag(page, await runCenter(page, 'para'), await runCenter(page, 'beta'), 2);
		await expect
			.poll(() => editorSelection(page))
			.toEqual({
				anchor: { path: [1], offset: 11 },
				focus: { path: [0], offset: 6 }
			});
	});

	test('a triple-drag into the next paragraph takes both blocks whole', async ({ page }) => {
		await multiClickDrag(page, await runCenter(page, 'beta'), await runCenter(page, 'para'), 3);
		await expect
			.poll(() => editorSelection(page))
			.toEqual({
				anchor: { path: [0], offset: 0 },
				focus: { path: [1], offset: 16 }
			});
	});

	test('a word-drag that leaves the block and returns collapses to the same-block range', async ({
		page
	}) => {
		const beta = await runCenter(page, 'beta');
		const para = await runCenter(page, 'para');
		const gamma = await runCenter(page, 'gamma');
		await page.mouse.move(beta.x, beta.y);
		await page.mouse.down();
		await page.mouse.up();
		await page.mouse.down({ clickCount: 2 });
		await page.mouse.move(para.x, para.y, { steps: 6 });
		await expect(editor.editorContainer).toHaveAttribute('data-cross-block');
		await page.mouse.move(gamma.x, gamma.y, { steps: 6 });
		await expect(editor.editorContainer).not.toHaveAttribute('data-cross-block');
		await page.mouse.up({ clickCount: 2 });
		await expect.poll(() => nativeSelectionText(page)).toBe('beta gamma');
	});

	test('a word-drag along a table cell joins its words', async ({ page }) => {
		await editor.loadContent('| a | b |\n| --- | --- |\n| one two three | c |\n');
		await multiClickDrag(page, await runCenter(page, 'one'), await runCenter(page, 'three'), 2);
		await expect.poll(() => nativeSelectionText(page)).toBe('one two three');
		await expect(editor.editorContainer).not.toHaveAttribute('data-cross-block');
	});
});
