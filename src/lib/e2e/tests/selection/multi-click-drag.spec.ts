import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import {
	editorSelection,
	gutterLeftOf,
	markerCenterOf,
	nativeSelectionText,
	pastLineEnd
} from './multi-click-helpers';
import { multiClick, multiClickDrag, multiClickHold } from '../../multi-click';
import { pointInGap, textRunCenter } from '../../text-runs';
import { nextRow } from '../presentation/helpers';

// Triple-click and the drags a multi-click starts
// (`requirements/selection/multi-click-drag.md`). Cross-block ranges are read from the editor's
// own endpoints: the native range is blank there.

const THREE = 'alpha beta gamma\n\nsecond para here\n\nthird one\n';

test.describe('multi-click: the block inline syntax handler and drags', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('triple-clicks and a double-click select the unit they land on', async ({ page }) => {
		await test.step('a triple-click selects the paragraph it lands in', async () => {
			await nextRow(editor, THREE);
			const at = await textRunCenter(page, 'para');
			await multiClick(page, at, 3);
			await expect.poll(() => nativeSelectionText(page)).toBe('second para here');
		});

		// The browser puts a caret down on the release of a click that landed on no glyph, over
		// whatever range it painted; the click handling cancels that release.
		await test.step('a triple-click past the end of a line still selects the paragraph', async () => {
			await nextRow(editor, THREE);
			const at = await pastLineEnd(page, 'gamma');
			await multiClick(page, at, 3);
			await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
			await page.waitForTimeout(150);
			await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
		});

		await test.step("a triple-click in a quote's gutter selects the quoted paragraph", async () => {
			await nextRow(editor, 'alpha beta gamma\n\n> quoted words here\n');
			const at = await gutterLeftOf(page, 'quoted');
			await multiClick(page, at, 3);
			await expect.poll(() => nativeSelectionText(page)).toBe('quoted words here');
		});

		await test.step("a double-click on a list item's marker takes the word beside it", async () => {
			await nextRow(editor, '- item one here\n- item two\n');
			const at = await markerCenterOf(page, 'item one');
			await multiClick(page, at, 2);
			await expect.poll(() => nativeSelectionText(page)).toBe('item');
		});
	});

	test('a word-drag within a block grows a word at a time, forward and backward', async ({
		page
	}) => {
		await test.step('forward', async () => {
			await nextRow(editor, THREE);
			await multiClickDrag(
				page,
				await textRunCenter(page, 'alpha'),
				await textRunCenter(page, 'gamma'),
				2
			);
			await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
		});

		await test.step('backward keeps the pressed word', async () => {
			await nextRow(editor, THREE);
			await multiClickDrag(
				page,
				await textRunCenter(page, 'gamma'),
				await textRunCenter(page, 'alpha'),
				2
			);
			await expect.poll(() => nativeSelectionText(page)).toBe('alpha beta gamma');
		});

		await test.step('along a table cell joins its words', async () => {
			await nextRow(editor, '| a | b |\n| --- | --- |\n| one two three | c |\n');
			await multiClickDrag(
				page,
				await textRunCenter(page, 'one'),
				await textRunCenter(page, 'three'),
				2
			);
			await expect.poll(() => nativeSelectionText(page)).toBe('one two three');
			await expect(editor.editorContainer).not.toHaveAttribute('data-cross-block');
		});
	});

	test('a drag from a multi-click across blocks ends on whole words or blocks', async ({
		page
	}) => {
		await test.step('a word-drag into the next paragraph ends at the end of the word under the pointer', async () => {
			await nextRow(editor, THREE);
			await multiClickDrag(
				page,
				await textRunCenter(page, 'beta'),
				await textRunCenter(page, 'para'),
				2
			);
			await expect
				.poll(() => editorSelection(page))
				.toEqual({
					anchor: { path: [0], offset: 6 },
					focus: { path: [1], offset: 11 }
				});
		});

		await test.step('a word-drag into the previous paragraph starts at the start of that word', async () => {
			await nextRow(editor, THREE);
			await multiClickDrag(
				page,
				await textRunCenter(page, 'para'),
				await textRunCenter(page, 'beta'),
				2
			);
			await expect
				.poll(() => editorSelection(page))
				.toEqual({
					anchor: { path: [1], offset: 11 },
					focus: { path: [0], offset: 6 }
				});
		});

		await test.step('a triple-drag into the next paragraph takes both blocks whole', async () => {
			await nextRow(editor, THREE);
			await multiClickDrag(
				page,
				await textRunCenter(page, 'beta'),
				await textRunCenter(page, 'para'),
				3
			);
			await expect
				.poll(() => editorSelection(page))
				.toEqual({
					anchor: { path: [0], offset: 0 },
					focus: { path: [1], offset: 16 }
				});
		});
	});

	test('a word-drag that leaves the block and returns collapses to the same-block range', async ({
		page
	}) => {
		await editor.loadContent(THREE);
		const beta = await textRunCenter(page, 'beta');
		const para = await textRunCenter(page, 'para');
		const gamma = await textRunCenter(page, 'gamma');
		const held = await multiClickHold(page, beta, 2);
		await page.mouse.move(para.x, para.y, { steps: 6 });
		await expect(editor.editorContainer).toHaveAttribute('data-cross-block');
		await page.mouse.move(gamma.x, gamma.y, { steps: 6 });
		await expect(editor.editorContainer).not.toHaveAttribute('data-cross-block');
		await held.release();
		await expect.poll(() => nativeSelectionText(page)).toBe('beta gamma');
	});

	// Level with a body row, in the editor's padding: a single click there focuses nothing either.
	for (const clicks of [2, 3]) {
		test(`a ${clicks === 2 ? 'double' : 'triple'}-click beside a table selects nothing`, async ({
			page
		}) => {
			await editor.loadContent('lead\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
			const cell = await page.locator('.table-cell').nth(2).boundingBox();
			if (!cell) throw new Error('no box for the first body cell');
			const table = page.locator(`[data-block-path='[1]']`);
			const at = await pointInGap(editor.editorContainer, table, 'right', cell.y + cell.height / 2);

			await multiClick(page, at, clicks);
			await page.keyboard.type('!');
			await editor.waitForNoSourceMutation();

			expect(await nativeSelectionText(page)).toBe('');
			expect(await editorSelection(page)).toBeNull();
			expect(await editor.bridge.getSource()).not.toContain('!');
		});
	}
});
