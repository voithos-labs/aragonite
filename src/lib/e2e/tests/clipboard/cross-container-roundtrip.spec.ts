import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('clipboard exploration: cross-container round-trip', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('copy from blockquote inner paragraph, paste into top-level paragraph', async () => {
		await editor.loadContent('> inside bq\n\ntarget para\n');

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([0, 0], 'inside bq'.length);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		await editor.focusBlockAtPath([1], 'target para'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('target parainside bq');

		const src = await editor.bridge.getSource();
		expect(src).toContain('target parainside bq');
		expect(src).toMatch(/> inside bq/);
	});

	test('copy a paragraph, paste into blockquote inner paragraph (structural preserves blockquote marker)', async () => {
		await editor.loadContent('outer para\n\n> target inside bq\n');

		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([0], 'outer para'.length);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		await editor.focusBlockAtPath([1, 0], 'target inside bq'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/> target inside bqouter para/);

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/> target inside bqouter para/);
	});

	test('copy across container boundary (blockquote → top-level), paste into fresh document', async () => {
		await editor.loadContent('> bq content\n\nouter para\n');

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([1], 'outer para'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		await editor.loadContent('destination\n');
		await editor.focusBlockAtPath([0], 'destination'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('bq content');

		const src = await editor.bridge.getSource();
		expect(src).toContain('bq content');
		expect(src).toContain('outer para');
	});
});
