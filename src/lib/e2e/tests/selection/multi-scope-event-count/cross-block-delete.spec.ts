import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';
import { nextRow } from '../../presentation/helpers';

test.describe('one edit event per op: cross-block delete', () => {
	test('Backspace over a cross-block selection emits one edit event, and the surviving list item keeps its id', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();

		await test.step('spanning two paragraphs', async () => {
			await nextRow(editor, 'first\n\nsecond\n');
			await editor.focusBlockEnd(0);
			await editor.page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);

			const count = await countEditEvents(editor, async () => {
				await editor.page.keyboard.press('Backspace');
				await editor.bridge.waitForBlockCount(1);
			});

			expect(count).toBe(1);
		});

		await test.step('spanning a list and a paragraph', async () => {
			await nextRow(editor, '- alpha\n- beta\n\nfollow\n');
			const lastItem = editor.page.locator('[contenteditable="true"]', { hasText: 'beta' });
			await lastItem.click();
			await editor.page.keyboard.press('End');
			await editor.page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);

			const count = await countEditEvents(editor, async () => {
				await editor.page.keyboard.press('Backspace');
				await editor.bridge.waitForBlockCount(1);
			});

			expect(count).toBe(1);
		});

		await test.step('the surviving list item keeps the start item id after a mixed cross-scope delete', async () => {
			await nextRow(editor, '- alpha\n- beta\n\nfollow\n');
			const before = await editor.bridge.getSource();

			const idsBefore: string[] = await editor.page.evaluate(() =>
				(window as any).__test.getListItemIds(0)
			);
			const alphaId = idsBefore[0];
			expect(alphaId).toBeTruthy();

			// Two Shift+ArrowDown keypresses select across two levels: from inside the list to the
			// top-level paragraph.
			await editor.focusBlockAtPath([0, 0, 0], 1);
			await editor.page.keyboard.press('Shift+ArrowDown');
			await editor.page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
			await editor.page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceWith((s, b) => s !== b, before);

			const idsAfter: string[] = await editor.page.evaluate(() =>
				(window as any).__test.getListItemIds(0)
			);
			expect(idsAfter.length).toBe(1);
			expect(idsAfter[0]).toBe(alphaId);
		});
	});
});
