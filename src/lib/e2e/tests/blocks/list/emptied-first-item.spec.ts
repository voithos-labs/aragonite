import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { findInput, openReplace, replaceInput, typeQuery } from '../../search/helpers';

// Requirements: `e2e/requirements/blocks/list/emptied-first-item.md`.

test.describe('emptying the first item of a list under a paragraph', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('para\n- x\n');
	});

	test('Backspace keeps the list, and a typed character lands in the item', async ({ page }) => {
		await editor.focusBlockAtPath([1, 0, 0], 1);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('para\n\n- \n');
		expect(await editor.parseConverged()).toBe(true);
		await editor.loadContent(await editor.bridge.getSource());
		expect([await editor.bridge.getBlockKind(0), await editor.bridge.getBlockKind(1)]).toEqual([
			'paragraph',
			'list'
		]);

		await editor.focusBlockAtPath([1, 0, 0], 0);
		await page.keyboard.type('y');
		await editor.bridge.waitForSourceEquals('para\n\n- y\n');
	});

	test('undo after Backspace gives back the loaded bytes', async ({ page }) => {
		await editor.focusBlockAtPath([1, 0, 0], 1);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('para\n\n- \n');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals('para\n- x\n');
	});

	test('a replace with nothing keeps the paragraph and the list', async ({ page }) => {
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'x');
		await replaceInput(page).fill('');
		await page.getByRole('button', { name: 'Replace', exact: true }).click();

		await editor.bridge.waitForSourceNotContains('x');
		expect(await editor.bridge.getSource()).toBe('para\n\n- \n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.parseConverged()).toBe(true);
	});
});
