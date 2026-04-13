import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('container block editing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// ── Happy paths ─────────────────────────────────────────────────────

	test('blockquote content is editable and source keeps > prefix', async () => {
		await editor.loadContent('> Hello world\n');
		const bq = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bq.click();
		await editor.typeText(' again');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^> .*Hello world again/m);
	});

	test('list item content is editable and source keeps marker', async () => {
		await editor.loadContent('- Item one\n');
		const item = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await item.click();
		await editor.typeText(' edited');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^- .*Item one edited/m);
	});

	test('Enter at end of list item creates new sibling item', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const firstItem = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await firstItem.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		const markers = (await editor.getSource()).match(/^- /gm) ?? [];
		expect(markers.length).toBeGreaterThanOrEqual(3);
	});

	test('blockquote source round-trips after editing', async () => {
		await editor.loadContent('> First line\n>\n> Second line\n');
		const inner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await inner.click();
		await editor.typeText(' appended');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('> ');
		expect(source).toContain('First line appended');
		expect(source).toContain('Second line');
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	test('empty list item exit — Enter on empty item exits the list', async () => {
		await editor.loadContent('- One\n- \n');
		const emptyItem = editor.getBlock(0).locator('[contenteditable="true"]').nth(1);
		await emptyItem.click();
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Should have exited the list — at least 2 top-level blocks now
		expect(await editor.getDomBlockCount()).toBeGreaterThanOrEqual(2);
		const source = await editor.getSource();
		expect(source).toContain('One');
		// The list should now have only one item (the empty one was removed)
		expect((source.match(/^- /gm) || []).length).toBe(1);
	});

	test('nested list renders as a single top-level block', async () => {
		await editor.loadContent('- Parent\n  - Child\n- Sibling\n');
		expect(await editor.getBlockKind(0)).toBe('list');
		expect(await editor.getBlockCount()).toBe(1);
	});

	test('blockquote with multiple paragraphs edits correctly', async () => {
		await editor.loadContent('> Para one\n>\n> Para two\n');
		const editables = editor.getBlock(0).locator('[contenteditable="true"]');
		expect(await editables.count()).toBeGreaterThanOrEqual(2);
		await editables.nth(1).click();
		await editor.typeText(' plus');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('Para two plus');
		expect(source).toMatch(/^> /m);
	});

	test('editing preserves container raw with correct indentation', async () => {
		await editor.loadContent('- Item A\n- Item B\n');
		const firstItem = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await firstItem.click();
		await editor.typeText(' ok');
		await editor.page.waitForTimeout(200);
		const lines = (await editor.getSource()).split('\n').filter((l: string) => l.trim().length > 0);
		for (const line of lines) {
			expect(line).toMatch(/^- /);
		}
	});

	test('Backspace on empty non-first list item deletes it', async () => {
		await editor.loadContent('- First\n- Second\n');
		// Create a new empty item after Second
		const lastItem = editor.getBlock(0).locator('[contenteditable="true"]').last();
		await lastItem.click();
		await editor.pressKey('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);

		// Now there are 3 items, cursor in the empty third item
		// Press Backspace — should delete the empty item
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const itemCount = (source.match(/^- /gm) || []).length;
		expect(itemCount).toBe(2);
		// Cursor should be at end of "Second"
		await editor.typeText('!');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('Second!');
	});

	test('ordered list numbering increments for new items', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const secondItem = editor.getBlock(0).locator('[contenteditable="true"]').nth(1);
		await secondItem.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/3\.\s/);
	});

	// ── User interactions ───────────────────────────────────────────────

	test('Enter at end of list item — typing goes into new item', async () => {
		await editor.loadContent('- Existing\n');
		const item = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.typeText('New item');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('Existing');
		expect(source).toContain('New item');
		expect((source.match(/^- /gm) ?? []).length).toBeGreaterThanOrEqual(2);
	});

	test('exit list at first item places cursor before list, not after', async () => {
		// Regression: exiting an empty first item teleported caret to after the list
		await editor.loadContent('- First\n- Second\n');
		const item = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await item.click();
		await editor.pressKey('Home');
		// Create empty first item by pressing Enter at start
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Go back to the now-empty first item
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		// Press Enter on empty item — should exit before the list
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Type in the new paragraph — should appear BEFORE list content
		await editor.typeText('Before list');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		const beforeIdx = source.indexOf('Before list');
		const firstIdx = source.indexOf('First');
		expect(beforeIdx).toBeLessThan(firstIdx);
	});

	test('blockquote exit via double-Enter keeps caret visible', async () => {
		// Regression: pressing Enter twice in a blockquote lost the caret
		await editor.loadContent('> Line one.\n>\n> Line two.\n');
		// Click into the last inner paragraph
		const editables = editor.getBlock(0).locator('[contenteditable="true"]');
		const lastEditable = editables.last();
		await lastEditable.click();
		await editor.pressKey('End');
		// First Enter: creates empty trailing paragraph inside blockquote
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Second Enter: should exit the blockquote
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Caret should be in a focusable block — typing should work
		await editor.typeText('After quote');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('After quote');
	});

	test('exit list then continue typing into new paragraph', async () => {
		await editor.loadContent('- Only\n');
		const item = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.typeText('After list');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('Only');
		expect(source).toContain('After list');
		// "After list" should not be inside a list marker line
		const afterIdx = source.indexOf('After list');
		const lineStart = source.lastIndexOf('\n', afterIdx) + 1;
		expect(source.slice(lineStart, lineStart + 2)).not.toBe('- ');
	});
});

test.describe('list indentation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab nests item under previous sibling', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		// Focus second item and press Tab
		const items = await editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(1).click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('- Item 1\n  - Item 2\n');
	});

	test('Tab on first item does nothing', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = await editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toBe('- Item 1\n- Item 2\n');
	});

	test('Shift+Tab promotes nested item to parent level', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		// Focus the nested item
		const nestedEditable = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nestedEditable.first().click();
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// Nested should now be a sibling between Item 1 and Item 2
		expect(source).toContain('- Item 1\n- Nested\n- Item 2\n');
	});

	test('Shift+Tab on top-level item does nothing', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toBe('- Item 1\n- Item 2\n');
	});
});

test.describe('nested list editing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('nested list renders correct block count', async () => {
		await editor.loadContent('- Item 1\n  - Nested a\n  - Nested b\n- Item 2\n');
		// Top-level: one list block
		expect(await editor.getBlockCount()).toBe(1);
		const source = await editor.getSource();
		expect(source).toContain('- Item 1');
		expect(source).toContain('  - Nested a');
	});

	test('editing nested item preserves structure', async () => {
		await editor.loadContent('- Item\n  - Nested\n');
		// Focus the nested item and type
		// Nested list items are .list-item-block inside .list-item-content > .list-block
		const nestedItem = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nestedItem.first().click();
		await editor.typeText(' more');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('  - Nested more');
	});

	test('multi-paragraph item round-trips after edit', async () => {
		await editor.loadContent('- Para 1\n\n  Para 2\n');
		expect(await editor.getBlockCount()).toBe(1);
		const source = await editor.getSource();
		expect(source).toBe('- Para 1\n\n  Para 2\n');
	});
});

// ── List bug fixes (0.3.2 regressions) ─────────────────────────────

test.describe('list bug fixes', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Bug 1a: Backspace on empty first item should delete it
	test('Backspace deletes empty first list item', async () => {
		await editor.loadContent('- \n- Second\n');
		const firstItem = editor.page.locator('[contenteditable="true"]').first();
		await firstItem.click();
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// The empty first item should be gone
		expect((source.match(/^- /gm) || []).length).toBe(1);
		expect(source).toContain('Second');
	});

	// Bug 1c: Backspace on nested item promotes it (like Shift+Tab)
	test('Backspace at start of nested item promotes it', async () => {
		await editor.loadContent('- Parent\n  - Nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'Nested' });
		await nested.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// Nested should now be a top-level sibling
		expect(source).toContain('- Parent\n- Nested\n');
	});

	// Bug 2a: Tab should keep cursor in the indented item
	test('Tab keeps cursor in the indented item, not at end of nested content', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const itemTwo = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await itemTwo.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		// Type to detect cursor position — should be at start of "Item 2"
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('ZItem 2');
	});

	// Bug 3a: Exit empty middle item should place cursor between remaining items
	test('exit empty middle item places cursor between siblings', async () => {
		await editor.loadContent('- First\n- Second\n- Third\n');
		// Empty the second item
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		// Press Enter to exit the empty item
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// Z should be between First and Third
		const zIdx = source.indexOf('Z');
		const thirdIdx = source.indexOf('Third');
		expect(zIdx).toBeLessThan(thirdIdx);
	});

	// Bug 3b: Enter on item with empty content but nested children should exit
	test('Enter on empty content exits even when item has nested children', async () => {
		await editor.loadContent('- Item\n  - Nested\n');
		// Press Enter at end of "Item" to split — nested list moves to new item
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item' }).first();
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		// Now in a new item with empty paragraph + nested list. Press Enter again.
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// Should NOT have 3+ list items — the empty one should have exited
		const itemCount = (source.match(/^- /gm) || []).length;
		expect(itemCount).toBeLessThanOrEqual(2);
	});

	// Bug 3c: New ordered list item should renumber subsequent items
	test('inserting ordered list item renumbers subsequent items', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.typeText('New');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// New should be 2, Second should be 3, Third should be 4
		expect(source).toMatch(/2\.\s*New/);
		expect(source).toMatch(/3\.\s*Second/);
		expect(source).toMatch(/4\.\s*Third/);
	});
});

test.describe('blockquote unwrap on Backspace (Rule U2)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('single-paragraph blockquote: Backspace at start lifts paragraph, deletes blockquote', async () => {
		await editor.loadContent('> Hello world\n');
		const bq = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bq.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).not.toContain('> ');
		expect(source).toContain('Hello world');
	});

	test('multi-paragraph blockquote: Backspace at start lifts only the first paragraph', async () => {
		await editor.loadContent('> First\n>\n> Second\n');
		const firstInner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await firstInner.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "First" should be plain paragraph (no > prefix on its line)
		expect(source).toMatch(/^First/m);
		// "Second" should still be inside a blockquote
		expect(source).toMatch(/^> Second/m);
	});

	test('nested blockquote: Backspace inside inner lifts content one level', async () => {
		await editor.loadContent('> > Deep\n');
		// Navigate into the innermost paragraph
		const deepEditable = editor.page.locator(
			'.blockquote-block .blockquote-block [contenteditable="true"]'
		);
		await deepEditable.first().click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// After one press: cursor is still inside the outer blockquote, but the
		// inner blockquote is gone. Expect one level of > prefix, not two.
		expect(source).toContain('> Deep');
		expect(source).not.toContain('> > ');
	});

	test('blockquote preceded by paragraph: no auto-merge', async () => {
		await editor.loadContent('Above paragraph.\n\n> Hello\n');
		const inner = editor.getBlock(1).locator('[contenteditable="true"]').first();
		await inner.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "Above" and "Hello" should be separate paragraphs, not merged.
		expect(source).toContain('Above paragraph.');
		expect(source).toContain('Hello');
		expect(source).not.toContain('Above paragraph.Hello');
		// Specifically: separated by a blank line
		expect(source).toMatch(/Above paragraph\.\n\s*\nHello/);
	});

	test('blockquote containing a list: Backspace at start of list item unwraps inside blockquote', async () => {
		await editor.loadContent('> - Item\n');
		const item = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await item.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// List's first-item unwrap (U1) runs inside the blockquote, producing
		// a plain paragraph "Item" still wrapped by `> `.
		expect(source).toContain('> Item');
		expect(source).not.toContain('- Item');
	});
});
