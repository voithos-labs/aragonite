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
		await editor.page.keyboard.type('\nconst y = 99;');
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
		await editor.page.keyboard.type('\n    return 42');
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
		await editor.page.keyboard.type('after code');
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
		await editor.page.keyboard.type(' appended');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('Above paragraph appended');
	});

	test('ArrowDown in last line exits to next block', async () => {
		await editor.loadContent('```\ncode here\n```\n\nBelow paragraph\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.type('prepended ');
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
		await editor.page.keyboard.type('line 1\nline 2\nline 3');
		await editor.page.waitForTimeout(200);
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.type('typed below');
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
		await editor.page.keyboard.type(' added');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('original added');
		await editor.undo();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).not.toContain('original added');
		expect(source).toContain('original');
	});
});
