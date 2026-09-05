import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('task checkbox — edit-event shape and cross-block click', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('clicking checkbox with active cross-block selection collapses and toggles', async () => {
		await editor.loadContent('- [ ] first\n- [ ] second\n');

		// Shift+ArrowDown from mid-block crosses into the sibling item; from
		// offset 0 it stays inside the first block on most platforms.
		await editor.focusBlockAtPath([0, 0, 0], 5);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.locator('.task-checkbox').first().click();
		await editor.bridge.waitForSourceContains('[x] first');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		expect((await editor.bridge.getSource()).trim()).toBe('- [x] first\n- [ ] second');
	});

	test('toggle emits exactly one metadataUpdate edit event', async () => {
		await editor.loadContent('- [ ] task\n');
		await editor.page.evaluate(() => (window as any).__test.startEditOpCapture());
		await editor.page.locator('.task-checkbox').first().click();
		await editor.bridge.waitForSourceContains('[x]');
		const ops = await editor.page.evaluate(() => (window as any).__test.stopEditOpCapture());
		expect(ops).toEqual(['metadataUpdate']);
	});
});
