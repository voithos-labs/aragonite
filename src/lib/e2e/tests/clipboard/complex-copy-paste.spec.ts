import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// DEFAULT_CONTENT CST paths:
// [0]="# Heading 1"  [1]="## Heading 2"  [2]="### Heading 3"
// [3]=paragraph (bold/italic/strikethrough/code)  [4]=paragraph (link)
// [5]=thematic break  [6]=blockquote ([6,0],[6,1])
// [7]=unordered list ([7,0,0],[7,1,0],[7,1,1,0,0],[7,2,0])
// [8]=ordered list ([8,0,0],[8,1,0],[8,2,0])
// [9]=code block  [10]="A final paragraph."

test.describe('clipboard — inline formatting preservation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('copy across formatted + link paragraphs preserves all markers', async () => {
		// Anchor at start of block 3, extend selection past end of block 4
		await editor.focusBlockStart(3);
		await editor.shiftClickBlock([4], 67); // full link paragraph
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('**bold text**');
		expect(clip).toContain('*italic text*');
		expect(clip).toContain('`inline code`');
		expect(clip).toContain('[link](https://example.com)');
	});

	test('copy heading through formatted paragraph preserves heading marker', async () => {
		// Anchor at start of "### Heading 3", extend to end of block 3
		await editor.focusBlockStart(2);
		await editor.shiftClickBlock([3], 70); // near end of formatted paragraph
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('### Heading 3');
		expect(clip).toContain('**bold text**');
	});
});

test.describe('clipboard — container boundary scenarios', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('copy last unordered + first ordered item excludes other items', async () => {
		// Anchor at "Item three" [7,2,0], extend to "First" [8,0,0]
		await editor.focusBlockAtPath([7, 2, 0], 0);
		await editor.shiftClickBlock([8, 0, 0], 5); // end of "First"
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Item three');
		expect(clip).toContain('First');
		expect(clip).not.toContain('Item one');
		expect(clip).not.toContain('Item two');
		expect(clip).not.toContain('Second');
	});

	test('copy from blockquote second paragraph to end collects list markers', async () => {
		// Start inside blockquote [6,1], Ctrl+Shift+End to select through end
		await editor.focusBlockAtPath([6, 1], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Second blockquote paragraph');
		expect(clip).toContain('- Item one');
		expect(clip).toContain('1. First');
		expect(clip).toContain('A final paragraph');
	});

	test('copy from ordered list last item across code block to final paragraph', async () => {
		// "Third" = [8,2,0]
		await editor.focusBlockAtPath([8, 2, 0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Third');
		expect(clip).toContain('const x = 42');
		expect(clip).toContain('A final paragraph');
		expect(clip).not.toContain('First');
		expect(clip).not.toContain('Second');
	});
});

test.describe('clipboard — code block boundary and direction', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('select inside code block across boundary into final paragraph', async () => {
		await editor.focusBlockStart(9);
		await editor.pressKey('Control+Shift+End');
		await editor.page.waitForTimeout(100);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('const x = 42');
		expect(clip).toContain('A final paragraph');
	});

	test('bottom-to-top selection copies the block above', async () => {
		await editor.focusBlockStart(1);
		await editor.pressKey('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		// Anchor is at offset 0 of block 1, so only block 0 content is selected.
		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('Heading 1');
		expect(clip).not.toContain('Heading 2');
	});
});

test.describe('clipboard — cut three blocks then undo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cut headings then undo restores all three', async () => {
		const before = await editor.getSource();

		// Select from "# Heading 1" start to "### Heading 3" end via shift-click
		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([2], 13); // end of "### Heading 3"
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);

		const afterCut = await editor.getSource();
		expect(afterCut).not.toContain('# Heading 1');
		expect(afterCut).not.toContain('## Heading 2');
		expect(afterCut).not.toContain('### Heading 3');

		await editor.undo();
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).toBe(before);
	});
});
