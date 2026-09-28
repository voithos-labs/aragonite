import { test, expect } from '../../fixtures';
import { DetailsPage, activeBlockPath, bodyHostCount, capturedErrors } from './details-helpers';
import { countEditEvents } from '../selection/multi-scope-event-count/helpers';

/**
 * Growing a selection past a closed `<details>` with Shift+Arrow
 * (requirements/plugins/details-extend.md): the range covers the hidden body, but getting there
 * never opens the block, so the bytes, the undo stack and the edit stream stay untouched until a
 * delete takes the whole block.
 */

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';

async function focusPath(editor: DetailsPage): Promise<{ path: number[]; offset: number } | null> {
	return (await editor.bridge.getSelectionPaths())?.focus ?? null;
}

test.describe('plugin container: extending a selection past a closed <details>', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
	});

	test('Shift+ArrowUp across a closed details never opens it, and a delete takes it whole', async ({
		page
	}) => {
		// [0] Above, [1] the details ([1,0] its title row), [2] Mid, [3] Below.
		const source = 'Above\n\n' + CLOSED + '\nMid\n\nBelow\n';
		await editor.loadContent(source);
		expect(await bodyHostCount(page)).toBe(1);
		await editor.focusBlockAtPath([3], 0);
		const undoDepth = await editor.bridge.getUndoDepth();

		const edits = await countEditEvents(editor, async () => {
			await page.keyboard.press('Shift+ArrowUp');
			await expect.poll(() => focusPath(editor)).toEqual({ path: [2], offset: 0 });
			await page.keyboard.press('Shift+ArrowUp');
			await expect.poll(() => focusPath(editor)).toEqual({ path: [1, 0], offset: 0 });
			await page.keyboard.press('Shift+ArrowUp');
			await expect.poll(() => focusPath(editor)).toEqual({ path: [0], offset: 0 });
		});

		expect(edits).toBe(0);
		expect(await editor.bridge.getUndoDepth()).toBe(undoDepth);
		expect(await editor.bridge.getSource()).toBe(source);
		expect(await bodyHostCount(page)).toBe(1);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('Below\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Shift+ArrowDown across a closed details never opens it, and a delete takes it whole', async ({
		page
	}) => {
		const source = 'Above\n\n' + CLOSED + '\nBelow\n';
		await editor.loadContent(source);
		await editor.focusBlockAtPath([0], 5);
		const undoDepth = await editor.bridge.getUndoDepth();

		const edits = await countEditEvents(editor, async () => {
			await page.keyboard.press('Shift+ArrowDown');
			await expect.poll(() => focusPath(editor)).toEqual({ path: [1, 0], offset: 0 });
			await page.keyboard.press('Shift+ArrowDown');
			await expect.poll(() => focusPath(editor)).toEqual({ path: [2], offset: 0 });
		});

		expect(edits).toBe(0);
		expect(await editor.bridge.getUndoDepth()).toBe(undoDepth);
		expect(await editor.bridge.getSource()).toBe(source);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('AboveBelow\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('ArrowRight after select-all over a closing details collapses to its title row, unopened', async ({
		page
	}) => {
		const source = 'Above\n\n' + CLOSED;
		await editor.loadContent(source);
		await editor.focusBlockAtPath([0], 0);
		const undoDepth = await editor.bridge.getUndoDepth();

		await editor.selectAll();
		await editor.selectAll();
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);

		expect(await editor.bridge.getSource()).toBe(source);
		expect(await editor.bridge.getUndoDepth()).toBe(undoDepth);
		expect(await bodyHostCount(page)).toBe(1);
		expect(await activeBlockPath(page)).toEqual([1, 0]);
	});

	test('Shift+ArrowUp twice from below a leading closed details stops on its title row', async ({
		page
	}) => {
		const source = CLOSED + '\nBelow\n';
		await editor.loadContent(source);
		await editor.focusBlockAtPath([1], 0);
		const undoDepth = await editor.bridge.getUndoDepth();

		await page.keyboard.press('Shift+ArrowUp');
		await page.keyboard.press('Shift+ArrowUp');
		await expect.poll(() => focusPath(editor)).toEqual({ path: [0, 0], offset: 0 });

		expect(await editor.bridge.getSource()).toBe(source);
		expect(await editor.bridge.getUndoDepth()).toBe(undoDepth);
		expect(await bodyHostCount(page)).toBe(1);
	});

	test('an undo whose range ends in the hidden body parks the caret on the title row, unopened', async ({
		page
	}) => {
		const source = 'Above\n\n' + CLOSED;
		await editor.loadContent(source);
		await editor.focusBlockAtPath([0], 0);
		await editor.selectAll();
		await editor.selectAll();
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('\n');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(source);
		await expect.poll(() => activeBlockPath(page)).toEqual([1, 0]);
		expect(await bodyHostCount(page)).toBe(1);
		expect(await editor.bridge.getSource()).toBe(source);
	});

	test('Backspace over a range ending on a closed title row takes the whole block', async ({
		page
	}) => {
		await editor.loadContent('Above\n\n' + CLOSED + '\nMid\n\nBelow\n');
		await editor.focusBlockAtPath([3], 0);
		await page.keyboard.press('Shift+ArrowUp');
		await page.keyboard.press('Shift+ArrowUp');
		await expect.poll(() => focusPath(editor)).toEqual({ path: [1, 0], offset: 0 });

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('Above\n\nBelow\n');
		await editor.typeText('x');
		await editor.bridge.waitForSourceEquals('Above\n\nxBelow\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Ctrl+X over a range onto a closed title row cuts the block, and a paste brings its body', async ({
		page
	}) => {
		await editor.loadContent('Above\n\n' + CLOSED);
		await editor.focusBlockAtPath([0], 2);
		// Past the title row's first character: the end then reaches into the hidden body.
		await page.keyboard.press('Shift+ControlOrMeta+End');
		await expect.poll(() => focusPath(editor)).toEqual({ path: [1, 0], offset: 3 });

		await page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceEquals('Ab\n');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.paste();

		await editor.bridge.waitForSourceContains(CLOSED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Shift+Mod+End into a closed details, then Backspace, empties the document', async ({
		page
	}) => {
		await editor.loadContent('Above\n\n' + CLOSED);
		await editor.focusBlockAtPath([0], 0);
		await page.keyboard.press('Shift+ControlOrMeta+End');
		await expect.poll(() => focusPath(editor)).toEqual({ path: [1, 0], offset: 3 });

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('\n');
		await editor.typeText('x');
		await editor.bridge.waitForSourceEquals('x\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Backspace from an open title row to the block below leaves a block that reloads the same', async ({
		page
	}) => {
		const open = '<details open>\n<summary>Sum</summary>\n\nShown\n\n</details>\n';
		await editor.loadContent('Above\n\n' + open + '\nMid\n');
		await editor.focusBlockAtPath([2], 0);
		await page.keyboard.press('Shift+ArrowUp');
		await page.keyboard.press('Shift+ArrowUp');
		await expect.poll(() => focusPath(editor)).toEqual({ path: [1, 0], offset: 0 });

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals(
			'Above\n\n<details open>\n<summary></summary>\n</details>\n\nMid\n'
		);
		expect(await editor.parseConverged()).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
