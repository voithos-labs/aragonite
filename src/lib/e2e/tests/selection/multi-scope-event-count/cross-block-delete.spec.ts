import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';

test.describe('one edit event per op — cross-block delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace on cross-block selection spanning two paragraphs emits one edit event', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('Backspace');
			await editor.bridge.waitForBlockCount(1);
		});

		expect(count).toBe(1);
	});

	test('Backspace on cross-block selection spanning list and paragraph emits one edit event', async () => {
		await editor.loadContent('- alpha\n- beta\n\nfollow\n');
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
});

test.describe('cross-block delete — list item id identity', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('surviving list item keeps start-item id after mixed cross-scope delete', async () => {
		await editor.loadContent('- alpha\n- beta\n\nfollow\n');
		const before = await editor.bridge.getSource();

		const idsBefore: string[] = await editor.page.evaluate(() =>
			(window as any).__test.getListItemIds(0)
		);
		const alphaId = idsBefore[0];
		expect(alphaId).toBeTruthy();

		// Two Shift+ArrowDown creates a mixed-scope selection: start descends
		// into the list, end is the top-level paragraph.
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
