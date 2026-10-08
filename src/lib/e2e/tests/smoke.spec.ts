import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { DEFAULT_CONTENT } from '../test-content';

test.describe('editor smoke tests', () => {
	test('the editor mounts, the bridge answers, and loadContent replaces the document', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();

		await test.step('the container is visible and the bridge reads a document', async () => {
			await expect(editor.editorContainer).toBeVisible();
			expect((await editor.bridge.getSource()).length).toBeGreaterThan(0);
		});

		await test.step('a second loadContent fully replaces the first', async () => {
			await editor.loadContent('# First load\n\nNew content here.\n');
			expect(await editor.bridge.getSource()).toContain('First load');

			await editor.loadContent('# Second load\n');
			const source = await editor.bridge.getSource();
			expect(source).toContain('Second load');
			expect(source).not.toContain('First load');
		});

		await test.step('many blocks load as many blocks', async () => {
			await editor.loadContent(DEFAULT_CONTENT);
			expect(await editor.bridge.getBlockCount()).toBeGreaterThanOrEqual(10);
		});

		await test.step('an empty document still renders one editable block', async () => {
			await editor.loadContent('');
			expect(await editor.getDomBlockCount()).toBeGreaterThanOrEqual(1);
		});
	});
});
