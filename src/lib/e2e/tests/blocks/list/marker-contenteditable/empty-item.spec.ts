import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list marker — empty item rendering and typing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('empty list item renders ambient marker plus <br> fallback', async () => {
		await editor.loadContent('- \n');
		const item = editor.page.locator('.list-item-block [contenteditable="true"]').first();
		const marker = item.locator('> span.md-marker[contenteditable="false"]');
		await expect(marker).toHaveText('- ');

		const br = item.locator('> br');
		await expect(br).toHaveCount(1);

		await item.click();
		await editor.typeText('X');
		await editor.bridge.waitForSourceEquals('- X\n');
		expect(await editor.bridge.getSource()).toBe('- X\n');
	});
});
