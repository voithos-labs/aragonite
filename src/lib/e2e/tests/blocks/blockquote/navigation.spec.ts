import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('blockquote navigation — basic traversal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown between two inner paragraphs', async () => {
		await editor.loadContent('> first\n>\n> second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^first$/ });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> Zsecond$/m);
	});

	test('ArrowUp between two inner paragraphs', async () => {
		await editor.loadContent('> first\n>\n> second\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: /^second$/ });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> firstZ$/m);
	});

	test('ArrowDown from last inner paragraph exits blockquote', async () => {
		await editor.loadContent('> quote\n\nafter\n');
		const quote = editor.page.locator('[contenteditable="true"]', { hasText: /^quote$/ });
		await quote.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^[^>].*Z/m);
	});

	test('ArrowUp from first inner paragraph exits blockquote', async () => {
		await editor.loadContent('before\n\n> quote\n');
		const quote = editor.page.locator('[contenteditable="true"]', { hasText: /^quote$/ });
		await quote.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^beforeZ$/m);
	});

	test('ArrowDown from paragraph before blockquote enters the blockquote', async () => {
		await editor.loadContent('before\n\n> quote\n');
		const before = editor.page.locator('[contenteditable="true"]', { hasText: /^before$/ });
		await before.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> Zquote$/m);
	});

	test('ArrowUp from paragraph after blockquote enters the blockquote', async () => {
		await editor.loadContent('> quote\n\nafter\n');
		const after = editor.page.locator('[contenteditable="true"]', { hasText: /^after$/ });
		await after.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> .*Z/m);
	});
});

test.describe('blockquote navigation — after Enter (empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of inner paragraph, then ArrowDown from empty paragraph reaches next paragraph', async () => {
		// No Markdown loads to {"1", "", "2"} — CommonMark collapses blank > lines.
		// Build the transient empty middle via a real Enter.
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> Z2$/m);
	});

	test('Enter at end of inner paragraph, then ArrowUp from empty paragraph reaches previous paragraph', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> Z1$/m);
	});
});

test.describe('blockquote navigation — after Backspace (delete empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Delete empty middle paragraph, then ArrowDown crosses the gap', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> [2Z]+$/m);
	});
});

test.describe('blockquote navigation — boundary crossing after U2 unwrap', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('After U2 unwrap: ArrowDown from lifted block enters the shrunk blockquote', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(300);
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> Z2$/m);
	});
});

test.describe('blockquote navigation — nested blockquote', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowUp from outer inner paragraph into nested inner paragraph', async () => {
		await editor.loadContent('> > deep\n>\n> outer\n');
		const outer = editor.page.locator('[contenteditable="true"]', { hasText: /^outer$/ });
		await outer.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> > .*Z/m);
	});

	test('ArrowDown from nested inner paragraph to outer inner paragraph', async () => {
		await editor.loadContent('> > deep\n>\n> outer\n');
		const deep = editor.page.locator('[contenteditable="true"]', { hasText: /^deep$/ });
		await deep.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> [^>].*Z/m);
	});
});

test.describe('blockquote navigation — long permutations', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('sequence of unrelated edits does not break final navigation', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.typeText(' extra');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toMatch(/^> Z2$/m);
	});
});
