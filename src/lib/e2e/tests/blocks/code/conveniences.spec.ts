import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

async function focusCodeBlockAtEnd(editor: EditorPage) {
	await editor.getBlock(0).click();
	await editor.page.keyboard.press('End');
}

async function expectBody(editor: EditorPage, expectedBody: string) {
	const source = await editor.getSource();
	const match = source.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
	expect(match, `could not parse code block body from source:\n${source}`).not.toBeNull();
	expect(match![1]).toBe(expectedBody);
}

test.describe('code block auto-indent on Enter', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of indented line copies the indent to the new line', async () => {
		await editor.loadContent('```\n\tfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.pressEnter();
		await editor.typeText('bar');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '\tfoo\n\tbar');
	});

	test('Enter preserves a multi-space indent verbatim', async () => {
		await editor.loadContent('```\n    foo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.pressEnter();
		await editor.typeText('bar');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '    foo\n    bar');
	});

	test('Enter at end of un-indented line inserts a bare newline', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.pressEnter();
		await editor.typeText('bar');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, 'foo\nbar');
	});

	test('Enter in the middle of an indented line carries the indent to the remainder', async () => {
		await editor.loadContent('```\n    foo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 10; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.pressEnter();
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '    fo\n    o');
	});
});

test.describe('code block electric indent', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter between {|} expands into three lines with one extra indent', async () => {
		await editor.loadContent('```\nf(){}\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 8; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.pressEnter();
		await editor.page.waitForTimeout(100);
		await expectBody(editor, 'f(){\n\t\n}');
	});

	test('Enter between indented {|} preserves outer indent and adds one more inside', async () => {
		await editor.loadContent('```\n\tf(){}\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 9; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.pressEnter();
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '\tf(){\n\t\t\n\t}');
	});

	test('Enter between "|" does NOT electric-indent (quotes stay inline)', async () => {
		await editor.loadContent('```\n""\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.pressEnter();
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '"\n"');
	});
});

test.describe('code block auto-close brackets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing ( on an empty line inserts ( and ) with cursor between', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '()');
		await editor.typeSlowly('x');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '(x)');
	});

	test('typing [ and { also auto-pair', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('[');
		await editor.page.waitForTimeout(50);
		await editor.typeSlowly('{');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '[{}]');
	});

	test('typing ( after a word (foo|) auto-pairs', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, 'foo()');
	});

	test('typing ( before an identifier inserts only (', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '(foo');
	});

	test('typing ( with a selection wraps the selection', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '(foo)');
	});
});

test.describe('code block auto-close quotes', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing " on an empty line inserts a pair', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('"');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '""');
		await editor.typeText('hi');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '"hi"');
	});

	test("typing ' between word chars (don|t) inserts only one quote", async () => {
		await editor.loadContent('```\ndont\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly("'");
		await editor.page.waitForTimeout(100);
		await expectBody(editor, "don't");
	});

	test("typing ' after an identifier ('don|) closes without duplicating", async () => {
		await editor.loadContent("```\n'don\n```\n");
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly("'");
		await editor.page.waitForTimeout(100);
		await expectBody(editor, "'don'");
	});

	test('typing ` auto-pairs inside a backtick-fenced code block', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('`');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '``');
	});
});

test.describe('code block skip-over and pair-delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing ) when the next char is already ) skips over', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(50);
		await editor.typeText('foo');
		await editor.page.waitForTimeout(50);
		await editor.typeSlowly(')');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '(foo)');
		await editor.typeSlowly('X');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '(foo)X');
	});

	test('typing " when the next char is already " skips over', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('"');
		await editor.page.waitForTimeout(50);
		await editor.typeText('hi');
		await editor.page.waitForTimeout(50);
		await editor.typeSlowly('"');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '"hi"');
		await editor.typeSlowly('Y');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '"hi"Y');
	});

	test('Backspace between an empty pair deletes both characters', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(50);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '');
	});

	test('Backspace between nested empty pairs deletes the innermost pair only', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(50);
		await editor.typeSlowly('[');
		await editor.page.waitForTimeout(50);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(100);
		await expectBody(editor, '()');
	});
});

test.describe('code block conveniences — undo and highlight.js interaction', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('auto-pair undoes in one Ctrl+Z', async () => {
		await editor.loadContent('```\nfoo\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, 'foo()');
		await editor.undo();
		await editor.page.waitForTimeout(150);
		await expectBody(editor, 'foo');
	});

	test('auto-indent works inside a js-highlighted code block', async () => {
		await editor.loadContent('```js\n\tconst x = 1;\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.pressEnter();
		await editor.typeText('const y = 2;');
		await editor.page.waitForTimeout(150);
		await expectBody(editor, '\tconst x = 1;\n\tconst y = 2;');
	});

	test('auto-close bracket works inside a js-highlighted code block', async () => {
		await editor.loadContent('```js\nfunction f\n```\n');
		await focusCodeBlockAtEnd(editor);
		await editor.typeSlowly('(');
		await editor.page.waitForTimeout(100);
		await expectBody(editor, 'function f()');
	});
});
