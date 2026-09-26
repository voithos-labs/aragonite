import { test, expect } from '../../fixtures';
import { DetailsPage, bodyHostCount, capturedErrors } from './details-helpers';
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
});
