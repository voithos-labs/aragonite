import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

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
		await editor.typeText('line two');
		await editor.page.waitForTimeout(200);
		expect(await editor.getBlockCount()).toBe(1);
		expect(await editor.getBlockKind(0)).toBe('fencedCode');
		const source = await editor.getSource();
		expect(source).toContain('line one\nline two');
	});

	test('plain Enter inserts a newline at the exact cursor position', async ({ page }) => {
		// Regression: default browser `insertParagraph` produced <div>/<br> with zero textContent change.
		await editor.loadContent('```\nabc\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toBe('```\na\nbc\n```\n');
	});

	test('plain Enter at end of body line inserts a blank line before the closer', async ({
		page
	}) => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toBe('```\nfoo\n\n```\n');
	});

	test('Enter twice from end of body line exits via blank-line path', async ({ page }) => {
		await editor.loadContent('```\nsome code\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 13; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		let source = await editor.getSource();
		expect(source).toContain('some code\n\n```');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.typeText('after code');
		await editor.page.waitForTimeout(200);
		source = await editor.getSource();
		expect(source).toContain('```\nsome code\n```');
		expect(source).not.toContain('some code\n\n```');
		expect(source.indexOf('after code')).toBeGreaterThan(source.lastIndexOf('```'));
	});

	test('Enter at end of a closed fence places the caret on the new line (typed text follows)', async ({
		page
	}) => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.pressEnter();
		await editor.page.waitForTimeout(150);
		await editor.typeText('bar');
		await editor.page.waitForTimeout(150);
		expect(await editor.getSource()).toBe('```\nfoo\nbar\n```\n');
	});

	test('Enter at end of an unclosed fence adds a body line and caret lands on it', async ({
		page
	}) => {
		// Regression: Chromium routed the next typed character BEFORE the trailing \n in unclosed fences.
		await editor.loadContent('```js\nconst x = 1\n');
		expect(await editor.getBlockKind(0)).toBe('fencedCode');
		await editor.getBlock(0).click();
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		await editor.page.waitForTimeout(150);
		await editor.typeText('const y = 2');
		await editor.page.waitForTimeout(150);
		const source = await editor.getSource();
		expect(source).toContain('const x = 1\nconst y = 2');
	});

	test('Enter mid-line in a multi-line code block splits at the cursor', async ({ page }) => {
		await editor.loadContent('```\naaaaa\nbbbbb\nccccc\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.pressEnter();
		await editor.page.waitForTimeout(150);
		await editor.typeText('X');
		await editor.page.waitForTimeout(150);
		const source = await editor.getSource();
		expect(source).toBe('```\naaaaa\nbb\nXbbb\nccccc\n```\n');
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
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		await editor.typeText('after code');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('after code');
		expect(source).toContain('some code');
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

test.describe('code block paste — fence bumping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste containing ``` into a code block bumps outer fence to ````', async ({ page }) => {
		await editor.loadContent('```\nfirst\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockEnd(0);

		await page.evaluate((text) => navigator.clipboard.writeText(text), '\n```pasted code```\n');
		await editor.pressKey('Control+v');
		await page.waitForTimeout(100);

		const source = await editor.getSource();
		expect(source).toMatch(/^````/m);
		expect(source).toContain('```pasted code```');
		expect(await editor.getBlockCount()).toBe(1);
		expect(await editor.getBlockKind(0)).toBe('fencedCode');
	});

	test('paste of multi-block markdown stays literal inside a code block', async ({ page }) => {
		await editor.loadContent('```\ncontent\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlock(0, 11);

		await page.evaluate(
			(text) => navigator.clipboard.writeText(text),
			'\n# Heading\n\n- list item\n\nparagraph\n'
		);
		await editor.pressKey('Control+v');
		await page.waitForTimeout(100);

		expect(await editor.getBlockCount()).toBe(1);
		expect(await editor.getBlockKind(0)).toBe('fencedCode');
		const source = await editor.getSource();
		expect(source).toContain('# Heading');
		expect(source).toContain('- list item');
		expect(source).toContain('paragraph');
	});
});

test.describe('code block tab / indent', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab with no selection inserts a literal tab', async ({ page }) => {
		await editor.loadContent('```\nhello\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await page.keyboard.press('Tab');
		await page.waitForTimeout(100);
		const source = await editor.getSource();
		expect(source).toContain('hel\tlo');
	});

	test('Tab with multi-line selection indents every covered line', async ({ page }) => {
		await editor.loadContent('```\nline1\nline2\nline3\n```\n');
		await editor.getBlock(0).click();

		await editor.focusBlock(0, 4);
		for (let i = 0; i < 11; i++) {
			await editor.pressKey('Shift+ArrowRight');
		}

		await page.keyboard.press('Tab');
		await page.waitForTimeout(100);

		const source = await editor.getSource();
		expect(source).toContain('\tline1');
		expect(source).toContain('\tline2');
		expect(source).toMatch(/^line3$/m);
	});

	test('Shift+Tab removes leading tab from current line', async ({ page }) => {
		await editor.loadContent('```\n\tindented\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await page.keyboard.press('Shift+Tab');
		await page.waitForTimeout(100);
		const source = await editor.getSource();
		expect(source).toContain('indented');
		expect(source).not.toContain('\tindented');
	});

	test('Shift+Tab removes up to 4 leading spaces', async ({ page }) => {
		await editor.loadContent('```\n    spaced\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 9; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await page.keyboard.press('Shift+Tab');
		await page.waitForTimeout(100);
		const source = await editor.getSource();
		expect(source).toContain('spaced');
		expect(source).not.toContain('    spaced');
	});

	test('Shift+Tab is a no-op on a line with no leading whitespace', async ({ page }) => {
		await editor.loadContent('```\nline\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('ArrowRight');
		}
		const sourceBefore = await editor.getSource();
		await page.keyboard.press('Shift+Tab');
		await page.waitForTimeout(100);
		const sourceAfter = await editor.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('Shift+Tab with multi-line selection dedents every covered line', async ({ page }) => {
		await editor.loadContent('```\n\tline1\n\tline2\nline3\n```\n');
		await editor.getBlock(0).click();

		await editor.focusBlock(0, 4);
		for (let i = 0; i < 18; i++) {
			await editor.pressKey('Shift+ArrowRight');
		}

		await page.keyboard.press('Shift+Tab');
		await page.waitForTimeout(100);

		const source = await editor.getSource();
		expect(source).toContain('line1');
		expect(source).toContain('line2');
		expect(source).not.toContain('\tline1');
		expect(source).not.toContain('\tline2');
		expect(source).toContain('line3');
	});
});
