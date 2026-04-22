import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { DEFAULT_CONTENT } from '../test-content';

test.describe('editor smoke tests', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('editor container is visible after goto', async () => {
		await expect(editor.editorContainer).toBeVisible();
	});

	test('test bridge is functional — getSource returns non-empty string', async () => {
		const source = await editor.getSource();
		expect(source.length).toBeGreaterThan(0);
	});

	test('loadContent replaces document', async () => {
		const custom = '# Replaced\n\nNew content here.\n';
		await editor.loadContent(custom);

		const source = await editor.getSource();
		expect(source).toContain('Replaced');
		expect(source).toContain('New content here.');
	});

	test('loadContent with multiple blocks yields correct block count', async () => {
		await editor.loadContent(DEFAULT_CONTENT);

		const count = await editor.getBlockCount();
		expect(count).toBeGreaterThanOrEqual(10);
	});

	test('empty document produces at least 1 editable block', async () => {
		await editor.loadContent('');

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBeGreaterThanOrEqual(1);
	});

	test('loadContent called twice — second call fully replaces first', async () => {
		await editor.loadContent('# First load\n');
		const afterFirst = await editor.getSource();
		expect(afterFirst).toContain('First load');

		await editor.loadContent('# Second load\n');
		const afterSecond = await editor.getSource();
		expect(afterSecond).toContain('Second load');
		expect(afterSecond).not.toContain('First load');
	});
});
