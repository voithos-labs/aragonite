import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// Syntax-highlight rendering for code blocks: .code-tok-* spans for known
// languages, .md-lang info-string styling, unknown-language fallthrough, and
// alias resolution (js === javascript).

test.describe('code block highlighting', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('tokenization renders .code-tok-keyword span for js const', async ({ page }) => {
		await editor.loadContent('```js\nconst x = 42;\n```\n');
		await page.waitForTimeout(100);
		const keywordSpan = editor.getBlock(0).locator('.code-tok-keyword').first();
		await expect(keywordSpan).toHaveText('const');
	});

	test('info string rendered with .md-lang class', async ({ page }) => {
		await editor.loadContent('```python\nprint("hi")\n```\n');
		await page.waitForTimeout(100);
		const langSpan = editor.getBlock(0).locator('.md-lang').first();
		await expect(langSpan).toHaveText('python');
	});

	test('unknown language falls through to plain text', async ({ page }) => {
		await editor.loadContent('```klingon\nkapla batleth\n```\n');
		await page.waitForTimeout(100);
		const tokSpans = await editor.getBlock(0).locator('[class^="code-tok-"]').count();
		expect(tokSpans).toBe(0);
		await expect(editor.getBlock(0)).toContainText('kapla batleth');
	});

	test('alias js produces same tokens as canonical javascript', async ({ page }) => {
		await editor.loadContent('```js\nconst x = 42;\n```\n\n```javascript\nconst x = 42;\n```\n');
		await page.waitForTimeout(100);

		const jsKeyword = await editor.getBlock(0).locator('.code-tok-keyword').first().textContent();
		const canonicalKeyword = await editor
			.getBlock(1)
			.locator('.code-tok-keyword')
			.first()
			.textContent();
		expect(jsKeyword).toBe(canonicalKeyword);
		expect(jsKeyword).toBe('const');
	});
});
