import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('task checkbox — toggle and undo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('clicking unchecked checkbox toggles to checked', async () => {
		await editor.loadContent('- [ ] pending\n');
		await editor.page.locator('.task-checkbox').first().click();
		await editor.bridge.waitForSourceContains('[x]');
		expect((await editor.bridge.getSource()).trim()).toBe('- [x] pending');
	});

	test('clicking checked checkbox toggles to unchecked', async () => {
		await editor.loadContent('- [x] done\n');
		await editor.page.locator('.task-checkbox').first().click();
		await editor.bridge.waitForSourceContains('[ ]');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] done');
	});

	test('toggle then Ctrl+Z restores pre-toggle source', async () => {
		await editor.loadContent('- [ ] task\n');
		await editor.page.locator('.task-checkbox').first().click();
		await editor.bridge.waitForSourceContains('[x]');

		await editor.undo();
		await editor.bridge.waitForSourceContains('[ ]');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] task');
	});

	test('toggle → undo → redo returns to checked state', async () => {
		await editor.loadContent('- [ ] task\n');
		await editor.page.locator('.task-checkbox').first().click();
		await editor.bridge.waitForSourceContains('[x]');

		await editor.undo();
		await editor.bridge.waitForSourceContains('[ ]');
		await editor.redo();
		await editor.bridge.waitForSourceContains('[x]');
		expect((await editor.bridge.getSource()).trim()).toBe('- [x] task');
	});

	test('uppercase [X] variant parses checked; toggle normalizes to lowercase', async () => {
		await editor.loadContent('- [X] upper\n');
		await editor.page.locator('.task-checkbox').first().click();
		await editor.bridge.waitForSourceContains('[ ]');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] upper');
	});
});
