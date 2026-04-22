import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { SIMPLE_CONTENT } from '../test-content';

test.describe('keyboard navigation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown at end of block moves focus to next block', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockEnd(0);
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('XSecond paragraph');
	});

	test('ArrowUp at start of block moves focus to previous block', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(1);
		await editor.pressArrowUp();
		await editor.typeText('Y');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('YFirst paragraph.');
	});

	test('ArrowDown at end of last block creates new paragraph', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		const countBefore = await editor.getDomBlockCount();
		const lastIndex = countBefore - 1;
		await editor.focusBlockEnd(lastIndex);
		await editor.pressArrowDown();
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);

		const countAfter = await editor.getDomBlockCount();
		expect(countAfter).toBe(countBefore + 1);
		const source = await editor.getSource();
		expect(source).toContain('Z');
	});

	test('ArrowUp at start of first block does nothing', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(0);
		await editor.pressArrowUp();
		await editor.typeText('A');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toMatch(/A.*First paragraph|First paragraphA/);
	});

	test('ArrowDown into container block enters first child', async () => {
		await editor.loadContent('Before\n\n> Inside quote\n');

		await editor.focusBlockEnd(0);
		await editor.pressArrowDown();
		await editor.typeText('Q');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toMatch(/> .*Inside quoteQ|> .*QInside quote/);
	});

	test('ArrowUp out of container block exits to block before', async () => {
		await editor.loadContent('Above\n\n> Quote content\n');

		const bqEditable = editor.getBlock(1).locator('[contenteditable="true"]').first();
		await bqEditable.click();
		await editor.page.keyboard.press('Home');
		await editor.pressArrowUp();
		await editor.typeText('B');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toMatch(/^[^>].*B/m);
	});

	test('ArrowDown on empty block moves to the next block', async () => {
		await editor.loadContent('Above.\n\nBelow.\n');
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		await editor.typeText('X');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('XBelow.');
	});

	test('navigate down through multiple blocks and type in final', async () => {
		await editor.loadContent('Block one.\n\nBlock two.\n\nBlock three.\n');

		await editor.focusBlockEnd(0);
		await editor.pressArrowDown();
		await editor.pressArrowDown();

		await editor.page.keyboard.press('End');
		await editor.typeText('!');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const hasExcl = source.includes('Block two.!') || source.includes('Block three.!');
		expect(hasExcl).toBe(true);
	});

	test('navigate up then type at start of first block', async () => {
		await editor.loadContent('Hello.\n\nWorld.\n');

		await editor.focusBlockStart(1);
		await editor.pressArrowUp();
		await editor.typeText('hi ');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('hi Hello.');
	});
});

// Regressions: structural ops (split/merge/delete) shift indices; container-block navigation must remain correct after.
test.describe('focus traversal after block insertion', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown traverses every block after splitBlock near containers', async () => {
		// Regression: stale index prop on container blocks (blockquote/list) after splitBlock caused focus to skip blocks.
		const content = [
			'# Title',
			'',
			'Paragraph before break.',
			'',
			'---',
			'',
			'> Quote line one',
			'>',
			'> Quote line two',
			'',
			'- Item one',
			'- Item two',
			'',
			'```',
			'code here',
			'```',
			'',
			'Final text.',
			''
		].join('\n');

		await editor.loadContent(content);

		await editor.focusBlockEnd(1);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);

		const bqBlock = editor.getBlock(4);
		const bqEditable = bqBlock.locator('[contenteditable="true"]').last();
		await bqEditable.click();
		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(100);

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		await editor.typeText('Z');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toMatch(/- .*Item one.*Z|Z.*Item one/m);
	});

	test('ArrowDown exits list to correct next block after splitBlock', async () => {
		const content = [
			'Some text.',
			'',
			'- Item one',
			'- Item two',
			'',
			'```',
			'code',
			'```',
			'',
			'After code.',
			''
		].join('\n');

		await editor.loadContent(content);

		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);

		const listBlock = editor.getBlock(2);
		const listEditables = listBlock.locator('[contenteditable="true"]');
		const lastItem = listEditables.last();
		await lastItem.click();
		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(100);

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		await editor.typeText('Z');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toMatch(/Z```|```Z|codeZ|Zcode/);
		expect(source).not.toMatch(/ZAfter code/);
	});

	test('ArrowDown traverses correctly after M1 list merge near a container', async () => {
		const content = [
			'- Item one',
			'- Item two',
			'',
			'```',
			'code',
			'```',
			'',
			'Final text.',
			''
		].join('\n');

		await editor.loadContent(content);

		const itemTwo = editor.page.locator('[contenteditable="true"]', { hasText: 'Item two' });
		await itemTwo.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);

		const listBlock = editor.getBlock(0);
		const listEditable = listBlock.locator('[contenteditable="true"]').first();
		await listEditable.click();
		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(100);

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);

		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toMatch(/Z```|```Z|codeZ|Zcode/);
		expect(source).not.toMatch(/ZFinal/);
	});

	test('ArrowDown traverses correctly after cross-container merge into blockquote', async () => {
		// Blank-line separator required due to lazy continuation.
		const content = ['> quote line', '', 'text', '', '```', 'code', '```', '', 'Final.', ''].join(
			'\n'
		);

		await editor.loadContent(content);

		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);

		const bqEditable = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bqEditable.click();
		await editor.pressKey('End');
		await editor.page.waitForTimeout(100);

		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toMatch(/Z```|```Z|codeZ|Zcode/);
		expect(source).not.toMatch(/ZFinal/);
		expect(source).toContain('> quote linetext');
	});
});

test.describe('geometry-based focus traversal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowUp at top of block moves to previous block', async () => {
		await editor.loadContent('# Title\n\nParagraph text.\n');
		await editor.focusBlock(1, 0);
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(100);
		await editor.typeText('!');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('!# Title');
	});

	test('ArrowDown at end of single-line block moves to next block', async () => {
		await editor.loadContent('First line.\n\nSecond line.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('!');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('!Second line.');
	});
});
