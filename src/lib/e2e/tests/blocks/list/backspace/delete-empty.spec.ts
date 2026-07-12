import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list Backspace — delete empty item', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace deletes empty first item', async () => {
		await editor.loadContent('- \n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]').first();
		await first.click();
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => (s.match(/^- /gm) || []).length === 1);
		const source = await editor.bridge.getSource();
		expect((source.match(/^- /gm) || []).length).toBe(1);
		expect(source).toContain('Second');
	});

	test('Backspace deletes empty non-first item', async () => {
		await editor.loadContent('- First\n- Second\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForListItemCount(3);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => (s.match(/^- /gm) || []).length === 2);
		const source = await editor.bridge.getSource();
		expect((source.match(/^- /gm) || []).length).toBe(2);
	});

	test('Backspace on empty only item deletes the entire list', async () => {
		await editor.loadContent('Above\n\n- \n\nBelow\n');
		const item = editor.page.locator('[contenteditable="true"]').nth(1);
		await item.click();
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !/^- /m.test(s));

		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^- /m);
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('AboveZ');
		expect(await editor.bridge.getSource()).toContain('AboveZ');
	});

	test('Backspace on empty only item when list is first block deletes the list', async () => {
		await editor.loadContent('- \n\nAfter\n');
		const item = editor.page.locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !/^- /m.test(s));

		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^- /m);
		expect(source).toContain('After');
	});
});
