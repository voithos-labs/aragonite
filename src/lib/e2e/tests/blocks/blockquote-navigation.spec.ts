/**
 * Blockquote navigation — arrow-key traversal inside / across blockquote
 * boundaries, before and after various structural edits. Companion to the
 * cross-container merge work in v0.3.4.
 * Requirements: e2e/requirements/blocks/blockquote-navigation.md
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

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
		await editor.pressKey('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at start of "second" → "Zsecond"
		expect(await editor.getSource()).toMatch(/^> Zsecond$/m);
	});

	test('ArrowUp between two inner paragraphs', async () => {
		await editor.loadContent('> first\n>\n> second\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: /^second$/ });
		await second.click();
		await editor.pressKey('Home');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at end of "first" → "firstZ"
		expect(await editor.getSource()).toMatch(/^> firstZ$/m);
	});

	test('ArrowDown from last inner paragraph exits blockquote', async () => {
		await editor.loadContent('> quote\n\nafter\n');
		const quote = editor.page.locator('[contenteditable="true"]', { hasText: /^quote$/ });
		await quote.click();
		await editor.pressKey('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at start of "after" → "Zafter"
		expect(await editor.getSource()).toMatch(/^Zafter$/m);
	});

	test('ArrowUp from first inner paragraph exits blockquote', async () => {
		await editor.loadContent('before\n\n> quote\n');
		const quote = editor.page.locator('[contenteditable="true"]', { hasText: /^quote$/ });
		await quote.click();
		await editor.pressKey('Home');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at end of "before" → "beforeZ"
		expect(await editor.getSource()).toMatch(/^beforeZ$/m);
	});

	test('ArrowDown from paragraph before blockquote enters the blockquote', async () => {
		await editor.loadContent('before\n\n> quote\n');
		const before = editor.page.locator('[contenteditable="true"]', { hasText: /^before$/ });
		await before.click();
		await editor.pressKey('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at start of "quote" → "> Zquote"
		expect(await editor.getSource()).toMatch(/^> Zquote$/m);
	});

	test('ArrowUp from paragraph after blockquote enters the blockquote', async () => {
		await editor.loadContent('> quote\n\nafter\n');
		const after = editor.page.locator('[contenteditable="true"]', { hasText: /^after$/ });
		await after.click();
		await editor.pressKey('Home');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at end of "quote" → "> quoteZ"
		expect(await editor.getSource()).toMatch(/^> quoteZ$/m);
	});
});

test.describe('blockquote navigation — after Enter (empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of inner paragraph, then ArrowDown from empty paragraph reaches next paragraph', async () => {
		// Build the state: > 1 / > [caret on empty] / > 2
		await editor.loadContent('> 1\n>\n> 2\n');
		const middle = editor.page.locator('[contenteditable="true"]').nth(1);
		await middle.click();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at start of "2"
		expect(await editor.getSource()).toMatch(/^> Z2$/m);
	});

	test('Enter at end of inner paragraph, then ArrowUp from empty paragraph reaches previous paragraph', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const middle = editor.page.locator('[contenteditable="true"]').nth(1);
		await middle.click();
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at end of "1"
		expect(await editor.getSource()).toMatch(/^> 1Z$/m);
	});

	test('After Enter at end of first paragraph: ArrowDown from new empty paragraph reaches second paragraph (user-reported recipe)', async () => {
		await editor.loadContent('> 1\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.pressKey('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		// Now at an empty second inner paragraph; "2" shifted to third
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at start of "2" → "Z2"
		expect(await editor.getSource()).toMatch(/^> Z2$/m);
	});
});

test.describe('blockquote navigation — after Backspace (delete empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Delete empty middle paragraph, then ArrowDown crosses the gap', async () => {
		// Build: > 1 / > [empty] / > 2 then delete the empty middle
		await editor.loadContent('> 1\n>\n> 2\n');
		const middle = editor.page.locator('[contenteditable="true"]').nth(1);
		await middle.click();
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		// Cursor should now be at end of "1"; ArrowDown should reach "2"
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/Z2/);
	});
});

test.describe('blockquote navigation — boundary crossing after U2 unwrap', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('After U2 unwrap: ArrowDown from lifted block enters the shrunk blockquote', async () => {
		// Layout: > 1 / > 2 → Backspace at start of "1" unwraps "1" out of blockquote
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);
		// Now: "1" is a plain paragraph before the shrunk blockquote containing "2"
		// ArrowDown from "1" should enter the blockquote and land on "2"
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^> Z2$/m);
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
		await editor.pressKey('Home');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/> > deepZ/);
	});

	test('ArrowDown from nested inner paragraph to outer inner paragraph', async () => {
		await editor.loadContent('> > deep\n>\n> outer\n');
		const deep = editor.page.locator('[contenteditable="true"]', { hasText: /^deep$/ });
		await deep.click();
		await editor.pressKey('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/> Zouter/);
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
		// Edit inside the first paragraph
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.pressKey('End');
		await editor.typeText(' extra');
		await editor.page.waitForTimeout(200);
		// Now navigate down to the second paragraph
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		// Navigate through the empty middle
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		// Should now be at start of "2"
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^> Z2$/m);
	});
});
