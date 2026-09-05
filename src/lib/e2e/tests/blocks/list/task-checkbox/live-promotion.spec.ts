import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('task checkbox — live promotion from typing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing `[ ] ` at start of plain list item promotes to task item live', async () => {
		await editor.loadContent('- plain\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('[ ] ');
		await editor.bridge.waitForSourceContains('[ ] plain');
		await editor.page.waitForSelector('.task-checkbox', { timeout: 2000 });
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] plain');
	});

	test('typing `[x] ` at start of plain list item promotes to checked task item live', async () => {
		await editor.loadContent('- work\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('[x] ');
		await editor.bridge.waitForSourceContains('[x] work');
		await editor.page.waitForSelector('.list-item-block[data-task-checked="true"]', {
			timeout: 2000
		});
		expect((await editor.bridge.getSource()).trim()).toBe('- [x] work');
	});

	test('checkbox characters cannot be edited via keyboard', async () => {
		await editor.loadContent('- [x] task\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('Z');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('[Zx]');
		expect(source).not.toContain('[xZ]');
		expect(source).toContain('[x]');
	});
});
