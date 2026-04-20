/**
 * Blockquote navigation — arrow-key traversal inside / across blockquote
 * boundaries, before and after various structural edits. Companion to the
 * cross-container merge work in v0.3.4.
 * Requirements: e2e/requirements/blocks/blockquote/navigation.md
 */
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
		// Use Home so sticky X ≈ 0 → focusAtColumn lands near start of "second"
		await editor.pressKey('Home');
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
		// Use End so sticky X ≈ right edge → focusAtColumn lands near end of "first"
		await editor.pressKey('End');
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
		await editor.pressKey('Home');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land somewhere in "after" (exact column depends on blockquote indent offset)
		expect(await editor.getSource()).toMatch(/^[^>].*Z/m);
	});

	test('ArrowUp from first inner paragraph exits blockquote', async () => {
		await editor.loadContent('before\n\n> quote\n');
		const quote = editor.page.locator('[contenteditable="true"]', { hasText: /^quote$/ });
		await quote.click();
		// Use End so sticky X ≈ right edge → focusAtColumn lands near end of "before"
		await editor.pressKey('End');
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
		// Use Home so sticky X ≈ 0 → focusAtColumn lands near start of "quote"
		await editor.pressKey('Home');
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
		// Use End so sticky X ≈ right edge → focusAtColumn lands somewhere in "quote"
		await editor.pressKey('End');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land somewhere in "quote" (exact column depends on cross-indentation X mapping)
		expect(await editor.getSource()).toMatch(/^> .*Z/m);
	});
});

test.describe('blockquote navigation — after Enter (empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of inner paragraph, then ArrowDown from empty paragraph reaches next paragraph', async () => {
		// There is no Markdown that loads to {"1", "", "2"} — CommonMark collapses
		// blank > lines into paragraph separators. The empty middle only exists
		// as a transient CST state after splitBlock. Build it via a real Enter.
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.pressKey('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Focus is now on the new empty middle paragraph (nth 1); "2" is at nth 2.
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land at start of "2"
		expect(await editor.getSource()).toMatch(/^> Z2$/m);
	});

	test('Enter at end of inner paragraph, then ArrowUp from empty paragraph reaches previous paragraph', async () => {
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.pressKey('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Focus on new empty middle (X ≈ 0); ArrowUp with sticky X ≈ 0 lands near start of "1".
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^> Z1$/m);
	});
});

test.describe('blockquote navigation — after Backspace (delete empty middle paragraph)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Delete empty middle paragraph, then ArrowDown crosses the gap', async () => {
		// Build {"1", "", "2"} via Enter (no Markdown loads that state — see
		// the "after Enter" describe block above), then Backspace to merge the
		// empty middle back into "1", then ArrowDown to reach "2".
		await editor.loadContent('> 1\n>\n> 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.pressKey('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Focus on the new empty middle; Backspace merges it back into "1".
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		// Cursor now at end of "1"; ArrowDown should reach "2".
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land somewhere in "2" (exact column set by sticky X from end of "1")
		expect(await editor.getSource()).toMatch(/^> [2Z]+$/m);
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
		// Use End so sticky X ≈ right edge → focusAtColumn lands somewhere in "deep"
		await editor.pressKey('End');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land somewhere in "deep" (exact column depends on cross-indentation X mapping)
		expect(await editor.getSource()).toMatch(/^> > .*Z/m);
	});

	test('ArrowDown from nested inner paragraph to outer inner paragraph', async () => {
		await editor.loadContent('> > deep\n>\n> outer\n');
		const deep = editor.page.locator('[contenteditable="true"]', { hasText: /^deep$/ });
		await deep.click();
		// Use Home so sticky X ≈ 0 → focusAtColumn lands somewhere in "outer"
		await editor.pressKey('Home');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// Z should land somewhere in "outer" (exact column depends on cross-indentation X mapping)
		expect(await editor.getSource()).toMatch(/^> [^>].*Z/m);
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
		// Edit inside the first paragraph, then Enter to create a transient
		// empty middle, then ArrowDown twice to cross into "2".
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^1$/ });
		await first.click();
		await editor.pressKey('End');
		await editor.typeText(' extra');
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Focus on new empty middle. First ArrowDown reaches "2".
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		// Type Z at start of "2".
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^> Z2$/m);
	});
});
