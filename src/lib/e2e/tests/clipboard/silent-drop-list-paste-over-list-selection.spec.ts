import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('clipboard: silent drop — multi-item list paste over multi-item list selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('shift-click cross-block, paste multi-item list over multi-item selection', async () => {
		await editor.loadContent('- target one\n- target two\n- target three\n- tail\n');
		await editor.seedClipboard('- alpha\n- beta\n- gamma\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'target two'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste();
		await editor.bridge.waitForSourceContains('alpha');

		const src = await editor.bridge.getSource();
		expect(src).toContain('alpha');
		expect(src).toContain('beta');
		expect(src).toContain('gamma');
		expect(src).toContain('target three');
		expect(src).not.toContain('target one');
		expect(src).not.toContain('target two');
	});

	test('Shift+Arrow cross-block, paste multi-item list over multi-item selection', async ({
		page
	}) => {
		await editor.loadContent('- target one\n- target two\n- target three\n- tail\n');
		await editor.seedClipboard('- alpha\n- beta\n- gamma\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await page.keyboard.down('Shift');
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('End');
		await page.keyboard.up('Shift');
		await editor.waitForCrossBlock(true);

		await editor.paste();
		await editor.bridge.waitForSourceContains('alpha');

		const src = await editor.bridge.getSource();
		expect(src).toContain('alpha');
		expect(src).toContain('beta');
		expect(src).toContain('gamma');
	});

	test('shift-click cross-block, paste nested list (nested structure preserved)', async () => {
		await editor.loadContent('- target one\n- target two\n- tail\n');
		await editor.seedClipboard('- outer a\n  - nested\n- outer b\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'target two'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste();
		await editor.bridge.waitForSourceContains('outer a');

		const src = await editor.bridge.getSource();
		expect(src).toContain('outer a');
		expect(src).toContain('nested');
		expect(src).toContain('outer b');
	});
});
