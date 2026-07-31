import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('code block highlighting', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('tokenization renders .code-tok-keyword span for js const', async () => {
		await editor.loadContent('```js\nconst x = 42;\n```\n');
		const keywordSpan = editor.getBlock(0).locator('.code-tok-keyword').first();
		await expect(keywordSpan).toHaveText('const');
	});

	test('info string rendered with .md-lang class', async () => {
		await editor.loadContent('```python\nprint("hi")\n```\n');
		const langSpan = editor.getBlock(0).locator('.md-lang').first();
		await expect(langSpan).toHaveText('python');
	});

	test('unknown language falls through to plain text', async () => {
		await editor.loadContent('```klingon\nkapla batleth\n```\n');
		await expect(editor.getBlock(0)).toContainText('kapla batleth');
		expect(await editor.getBlock(0).locator('[class^="code-tok-"]').count()).toBe(0);
	});

	test('alias js produces same tokens as canonical javascript', async () => {
		await editor.loadContent('```js\nconst x = 42;\n```\n\n```javascript\nconst x = 42;\n```\n');

		const jsKeywordLocator = editor.getBlock(0).locator('.code-tok-keyword').first();
		await expect(jsKeywordLocator).toHaveText('const');

		const canonicalKeyword = await editor
			.getBlock(1)
			.locator('.code-tok-keyword')
			.first()
			.textContent();
		expect(canonicalKeyword).toBe('const');
	});
});
