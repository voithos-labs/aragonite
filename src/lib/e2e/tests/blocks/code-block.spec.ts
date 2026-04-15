import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('code block editing — happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing inside code block updates source', async () => {
		await editor.loadContent('```javascript\nconst x = 42;\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.typeText('\nconst y = 99;');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('const x = 42;');
		expect(source).toContain('const y = 99;');
	});

	test('Enter creates newline inside code block, does not split', async () => {
		await editor.loadContent('```\nline one\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		expect(await editor.getBlockCount()).toBe(1);
		expect(await editor.getBlockKind(0)).toBe('fencedCode');
	});

	test('code block content round-trips through source', async () => {
		await editor.loadContent('```python\ndef hello():\n    pass\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.typeText('\n    return 42');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/```python/);
		expect(source).toContain('def hello():');
		expect(source).toContain('return 42');
		expect(source).toMatch(/```\s*$/m);
	});
});

test.describe('code block editing — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('exit code block via Enter on empty trailing line', async () => {
		await editor.loadContent('```\nsome code\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('Control+End');
		// First Enter adds trailing newline; second Enter exits code block
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		// Type to prove focus exited the code block
		await editor.typeText('after code');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('after code');
		expect(source).toContain('some code');
		// "after code" must appear after the closing fence
		expect(source.indexOf('after code')).toBeGreaterThan(source.lastIndexOf('```'));
	});

	test('ArrowUp in first line exits to previous block', async () => {
		await editor.loadContent('Above paragraph\n\n```\ncode here\n```\n');
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Control+Home');
		await editor.page.waitForTimeout(100);
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('End');
		await editor.typeText(' appended');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('Above paragraph appended');
	});

	test('ArrowDown in last line exits to next block', async () => {
		await editor.loadContent('```\ncode here\n```\n\nBelow paragraph\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(200);
		await editor.typeText('prepended ');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('prepended');
	});

	test('Backspace at position 0 moves focus without deleting code block', async () => {
		await editor.loadContent('Before\n\n```\ncode\n```\n');
		const countBefore = await editor.getBlockCount();
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		expect(await editor.getBlockCount()).toBe(countBefore);
		expect(await editor.getSource()).toContain('code');
	});
});

test.describe('code block editing — user interactions', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('type multi-line code then navigate out via ArrowDown', async () => {
		await editor.loadContent('```\n\n```\n\nTarget\n');
		await editor.getBlock(0).click();
		await editor.typeText('line 1\nline 2\nline 3');
		await editor.page.waitForTimeout(200);
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(200);
		await editor.typeText('typed below');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('line 1');
		expect(source).toContain('line 3');
		expect(source).toContain('typed below');
	});

	test('edit code then undo reverts the change', async () => {
		await editor.loadContent('```\noriginal\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.typeText(' added');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('original added');
		await editor.undo();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).not.toContain('original added');
		expect(source).toContain('original');
	});
});

test.describe('code block keyboard — beyond parity', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+B inside a code block is a no-op', async ({ page }) => {
		await editor.loadContent('```js\nconst x = 42;\n```\n');
		await editor.getBlock(0).click();
		const sourceBefore = await editor.getSource();
		await page.keyboard.press('Control+b');
		await page.waitForTimeout(50);
		const sourceAfter = await editor.getSource();
		expect(sourceAfter).toBe(sourceBefore);
		expect(await editor.getBlock(0).locator('b').count()).toBe(0);
		expect(await editor.getBlock(0).locator('strong').count()).toBe(0);
	});

	test('Ctrl+I inside a code block is a no-op', async ({ page }) => {
		await editor.loadContent('```js\nconst x = 42;\n```\n');
		await editor.getBlock(0).click();
		const sourceBefore = await editor.getSource();
		await page.keyboard.press('Control+i');
		await page.waitForTimeout(50);
		const sourceAfter = await editor.getSource();
		expect(sourceAfter).toBe(sourceBefore);
		expect(await editor.getBlock(0).locator('i').count()).toBe(0);
		expect(await editor.getBlock(0).locator('em').count()).toBe(0);
	});

	test('ArrowLeft at offset 0 moves focus to previous block', async ({ page }) => {
		await editor.loadContent('text above\n\n```\ncode\n```\n');
		await editor.getBlock(1).click();
		await editor.focusBlockStart(1);
		await page.keyboard.press('ArrowLeft');
		await page.waitForTimeout(50);
		await editor.typeText('X');
		const source = await editor.getSource();
		expect(source.split('\n')[0]).toContain('X');
	});

	test('ArrowRight at end of content moves focus to next block', async ({ page }) => {
		await editor.loadContent('```\ncode\n```\n\ntext below\n');
		await editor.getBlock(0).click();
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(50);
		await editor.typeText('X');
		const source = await editor.getSource();
		expect(source).toMatch(/Xtext below/);
	});

	test('vertical arrow sticky column preserved through code block', async ({ page }) => {
		await editor.loadContent(
			'aaaaaaaaaaaaaaaaaaaaaaaaaaa\n\n```\nshort\nshort\n```\n\nbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
		);

		await editor.getBlock(0).click();
		await page.keyboard.press('Home');
		for (let i = 0; i < 20; i++) {
			await page.keyboard.press('ArrowRight');
		}

		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);
		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);
		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);
		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(50);

		await editor.typeText('X');
		const source = await editor.getSource();
		const lastParagraph = source.split('\n\n').pop() ?? '';

		const xIndex = lastParagraph.indexOf('X');
		expect(xIndex).toBeGreaterThanOrEqual(15);
		expect(xIndex).toBeLessThanOrEqual(25);
	});

	test('Shift+Enter inserts \\n, not <br>', async ({ page }) => {
		await editor.loadContent('```\nfirst line\n```\n');
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.typeText('second line');
		await page.waitForTimeout(100);

		const source = await editor.getSource();
		expect(source).toContain('first line\nsecond line');

		expect(await editor.getBlock(0).locator('br').count()).toBe(0);
	});
});

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
