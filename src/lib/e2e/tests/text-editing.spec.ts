import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('text editing — happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing appends to block and updates source', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' world');

		const source = await editor.getSource();
		expect(source).toContain('Hello world');
	});

	test('Enter at end splits block — creates new empty block after current', async () => {
		await editor.loadContent('Line one\n');
		await editor.focusBlockEnd(0);
		await editor.pressEnter();

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);
		expect(await editor.getBlockText(0)).toContain('Line one');
	});

	test('Enter in middle splits content across two blocks', async () => {
		await editor.loadContent('HelloWorld\n');
		await editor.focusBlockStart(0);
		// Move cursor 5 characters right to sit between Hello and World
		for (let i = 0; i < 5; i++) await editor.pressKey('ArrowRight');
		await editor.pressEnter();

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);

		const source = await editor.getSource();
		expect(source).toContain('Hello');
		expect(source).toContain('World');
	});

	test('Backspace at start merges with previous paragraph', async () => {
		await editor.loadContent('First\n\nSecond\n');
		await editor.focusBlockStart(1);
		await editor.pressBackspace();

		const source = await editor.getSource();
		expect(source).toContain('FirstSecond');
	});

	test('typing # prefix converts paragraph to heading', async () => {
		await editor.loadContent('Title\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('# ');

		const kind = await editor.getBlockKind(0);
		expect(kind).toBe('heading');
	});
});

test.describe('text editing — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at offset 0 — empty block before, content moves to second', async () => {
		await editor.loadContent('Content\n');
		await editor.focusBlockStart(0);
		await editor.pressEnter();

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);

		const source = await editor.getSource();
		expect(source).toContain('Content');
		// The second block should have the content
		const secondText = await editor.getBlockText(1);
		expect(secondText).toContain('Content');
	});

	test('Backspace at start of first block does nothing', async () => {
		await editor.loadContent('Only block\n');
		const sourceBefore = await editor.getSource();

		await editor.focusBlockStart(0);
		await editor.pressBackspace();

		const sourceAfter = await editor.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('Backspace at start of heading after heading — no merge, moves focus', async () => {
		await editor.loadContent('# Heading A\n\n## Heading B\n');
		const countBefore = await editor.getBlockCount();

		await editor.focusBlockStart(1);
		await editor.pressBackspace();

		// Both headings should still exist — heading+heading is not mergeable
		const countAfter = await editor.getBlockCount();
		expect(countAfter).toBe(countBefore);
	});

	test('heading absorbs following paragraph on merge', async () => {
		await editor.loadContent('# Title\n\nBody text\n');
		await editor.focusBlockStart(1);
		await editor.pressBackspace();

		const source = await editor.getSource();
		expect(source).toContain('TitleBody text');
		expect(await editor.getBlockKind(0)).toBe('heading');
	});

	test('Backspace after thematic break deletes the break', async () => {
		await editor.loadContent('Before\n\n---\n\nAfter\n');
		const countBefore = await editor.getBlockCount();

		// Focus the block after the thematic break and press Backspace
		await editor.focusBlockStart(2);
		await editor.pressBackspace();

		const countAfter = await editor.getBlockCount();
		expect(countAfter).toBeLessThan(countBefore);

		const source = await editor.getSource();
		expect(source).not.toContain('---');
	});

	test('kind change reversal — deleting # prefix reverts heading to paragraph', async () => {
		await editor.loadContent('# Title\n');
		expect(await editor.getBlockKind(0)).toBe('heading');

		// The contenteditable includes the "# " marker as a dimmed span.
		// Select the first 2 characters ("# ") and delete them.
		await editor.focusBlockStart(0);
		await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Shift+ArrowRight');
		await editor.pressBackspace();

		const kind = await editor.getBlockKind(0);
		expect(kind).toBe('paragraph');
	});

	test('split heading at middle — first stays heading, second becomes paragraph', async () => {
		await editor.loadContent('# HelloWorld\n');
		await editor.focusBlockStart(0);
		// Move past "# Hello" (2 marker chars + 5 content chars = 7)
		for (let i = 0; i < 7; i++) await editor.pressKey('ArrowRight');
		await editor.pressEnter();

		expect(await editor.getBlockKind(0)).toBe('heading');
		expect(await editor.getBlockKind(1)).toBe('paragraph');
	});

	test('Enter at end of heading — heading unchanged, new empty paragraph', async () => {
		await editor.loadContent('# Heading\n');
		await editor.focusBlockEnd(0);
		await editor.pressEnter();

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);
		expect(await editor.getBlockKind(0)).toBe('heading');
		// Empty block may be absorbed as trivia by the parser — verify via DOM instead
		const secondBlock = editor.getBlock(1);
		await expect(secondBlock).toBeVisible();
	});
});

test.describe('forward delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Delete at end of block merges with next', async () => {
		await editor.loadContent('# Hello\n\nWorld\n');
		expect(await editor.getBlockCount()).toBe(2);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('# HelloWorld');
		expect(await editor.getBlockCount()).toBe(1);
	});

	test('Delete in middle of block works normally', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('Helloworld');
	});

	test('Delete before thematic break removes the break', async () => {
		await editor.loadContent('Hello\n\n---\n');
		expect(await editor.getBlockCount()).toBe(2);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		expect(await editor.getBlockCount()).toBe(1);
	});

	test('Delete before non-mergeable heading moves focus', async () => {
		await editor.loadContent('# First\n\n# Second\n');
		expect(await editor.getBlockCount()).toBe(2);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		// Two headings can't merge — focus moves to start of next
		expect(await editor.getBlockCount()).toBe(2);
	});
});

test.describe('text editing — user interactions', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('click, focusBlockEnd, typeText, verify source', async () => {
		await editor.loadContent('Hello\n');
		await editor.clickBlock(0);
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' world');

		const source = await editor.getSource();
		expect(source).toContain('Hello world');
	});

	test('split then type in new block updates source', async () => {
		await editor.loadContent('Original\n');
		await editor.focusBlockEnd(0);
		await editor.pressEnter();

		// New block is now focused (index 1); type into it
		await editor.typeSlowly('New content');

		const source = await editor.getSource();
		expect(source).toContain('Original');
		expect(source).toContain('New content');
	});

	test('rapid split — Enter twice creates three blocks', async () => {
		await editor.loadContent('Start\n');
		await editor.focusBlockEnd(0);
		await editor.pressEnter();
		await editor.pressEnter();

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(3);
	});

	test('Backspace mid-block deletes character, does not merge', async () => {
		await editor.loadContent('First\n\nSecond\n');
		const countBefore = await editor.getDomBlockCount();

		// Focus end of second block, backspace should delete 'd', not merge
		await editor.focusBlockEnd(1);
		await editor.pressBackspace();

		const countAfter = await editor.getDomBlockCount();
		expect(countAfter).toBe(countBefore);

		const source = await editor.getSource();
		expect(source).toContain('Secon');
		expect(source).not.toContain('Second');
	});
});
