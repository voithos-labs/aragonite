import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// Typing and Enter behavior inside a fenced code block: plain typing, literal
// newline insertion, mid-line splits, and the open/closed fence Enter paths.
// Block-exit navigation, keyboard parity, highlighting, paste, and indent live
// in sibling editing-*.spec.ts files.

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
