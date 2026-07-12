import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list marker — rendering and round-trip', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('unordered marker renders as .md-marker span inside first child', async () => {
		await editor.loadContent('- Hello\n');
		const markerInside = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker[contenteditable="false"]'
		);
		await expect(markerInside).toHaveText('- ');

		const oldFlexSibling = editor.page.locator('span.list-item-marker');
		await expect(oldFlexSibling).toHaveCount(0);
	});

	test('ordered marker renders with correct number inside first child', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const markers = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker[contenteditable="false"]'
		);
		await expect(markers.nth(0)).toHaveText('1. ');
		await expect(markers.nth(1)).toHaveText('2. ');
	});

	test('source round-trips after load', async () => {
		await editor.loadContent('- Hello\n');
		expect(await editor.bridge.getSource()).toBe('- Hello\n');
	});

	test('nested list: each level gets its own ambient marker', async () => {
		await editor.loadContent('- Parent\n  - Child\n');
		const markers = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker[contenteditable="false"]'
		);
		expect(await markers.count()).toBe(2);
		await expect(markers.nth(0)).toHaveText('- ');
		await expect(markers.nth(1)).toHaveText('- ');
	});
});
