import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('selection & clipboard — happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('select text with Shift+Arrow then copy+paste duplicates text', async () => {
		await editor.loadContent('abcdef\n');
		await editor.focusBlockStart(0);
		// Select "abc"
		for (let i = 0; i < 3; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+c');
		// Move to end and paste
		await editor.pressKey('End');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('abcdefabc');
	});

	test('select text then cut removes selected text', async () => {
		await editor.loadContent('HelloWorld\n');
		await editor.focusBlockStart(0);
		// Select "Hello"
		for (let i = 0; i < 5; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).not.toContain('Hello');
		expect(source).toContain('World');
	});

	test('select text then paste replaces selection', async () => {
		await editor.loadContent('AAABBB\n');
		await editor.focusBlockStart(0);
		// Select "AAA" and copy
		for (let i = 0; i < 3; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+c');
		// Collapse selection to end, then select "BBB"
		await editor.pressKey('ArrowRight');
		for (let i = 0; i < 3; i++) await editor.pressKey('Shift+ArrowRight');
		// Paste "AAA" over "BBB"
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('AAAAAA');
		expect(source).not.toContain('BBB');
	});

	test('select text then type replaces selection with typed text', async () => {
		await editor.loadContent('OldText\n');
		await editor.focusBlockStart(0);
		// Select "Old"
		for (let i = 0; i < 3; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.typeText('New');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('NewText');
		expect(source).not.toContain('Old');
	});
});

test.describe('selection & clipboard — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cut then undo restores text', async () => {
		await editor.loadContent('Restore me\n');
		await editor.focusBlockStart(0);
		// Select "Restore"
		for (let i = 0; i < 7; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).not.toContain('Restore');

		await editor.undo();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('Restore me');
	});

	test('paste at end of block appends text', async () => {
		await editor.loadContent('Start\n');
		// First, put known text on clipboard: select all, copy, then restore
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+c');
		// Collapse selection, move to end, paste
		await editor.pressKey('End');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('StartStart');
	});

	test('paste at start of block prepends text', async () => {
		await editor.loadContent('End\n');
		// Copy "End" to clipboard
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+c');
		// Move to start and paste
		await editor.pressKey('Home');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('EndEnd');
	});

	test('copy does not modify source', async () => {
		await editor.loadContent('Unchanged\n');
		const sourceBefore = await editor.getSource();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const sourceAfter = await editor.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('cut empty selection is a no-op', async () => {
		await editor.loadContent('NoChange\n');
		const sourceBefore = await editor.getSource();
		await editor.focusBlockEnd(0);
		// No selection — just cursor
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(200);

		const sourceAfter = await editor.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});
});

test.describe('selection & clipboard — user interactions', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('select word via Shift+Arrow then cut+paste elsewhere', async () => {
		await editor.loadContent('First\n\nSecond\n');
		await editor.focusBlockStart(0);
		// Select "First"
		for (let i = 0; i < 5; i++) await editor.pressKey('Shift+ArrowRight');
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).not.toContain('First');

		// Paste into second block at end
		await editor.focusBlockEnd(1);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('SecondFirst');
	});

	test('select all in block via Ctrl+A then replace by typing', async () => {
		await editor.loadContent('Replace this entirely\n');
		await editor.focusBlockStart(0);
		await editor.selectAll();
		await editor.typeText('Brand new');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('Brand new');
		expect(source).not.toContain('Replace this entirely');
	});
});

test.describe('multi-block paste', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pasting two paragraphs creates multiple blocks', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		// Dispatch a paste event with multi-block markdown content
		await editor.page.evaluate(() => {
			const el = document.activeElement;
			if (!el) return;
			const dt = new DataTransfer();
			dt.setData('text/plain', '# Heading\n\nNew paragraph\n');
			const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
			el.dispatchEvent(event);
		});
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('# Heading');
		expect(source).toContain('New paragraph');
		expect(await editor.getBlockCount()).toBeGreaterThan(1);
	});

	test('multi-block paste replaces selected text', async () => {
		await editor.loadContent('Hello World\n');
		await editor.focusBlock(0, 6);
		// Select "World" (5 characters)
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		// Paste multi-block content replacing "World"
		await editor.page.evaluate(() => {
			const el = document.activeElement;
			if (!el) return;
			const dt = new DataTransfer();
			dt.setData('text/plain', 'First\n\nSecond');
			const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
			el.dispatchEvent(event);
		});
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// "World" must be gone — replaced by the pasted content
		expect(source).not.toContain('World');
		// The text before the selection should survive
		expect(source).toContain('Hello ');
		// Both pasted blocks should be present
		expect(source).toContain('First');
		expect(source).toContain('Second');
	});

	test('pasting single line stays inline', async () => {
		await editor.loadContent('Hello \n');
		await editor.focusBlock(0, 6);
		// Dispatch a paste event with single-line content
		await editor.page.evaluate(() => {
			const el = document.activeElement;
			if (!el) return;
			const dt = new DataTransfer();
			dt.setData('text/plain', 'world');
			const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
			el.dispatchEvent(event);
		});
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('Hello world');
		expect(await editor.getBlockCount()).toBe(1);
	});
});
