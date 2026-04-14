/**
 * Comprehensive list block tests.
 * Requirements: e2e/requirements/blocks/list-block.md
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// ── Rendering ───────────────────────────────────────────────────────

test.describe('list rendering', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('nested list renders as single top-level block', async () => {
		await editor.loadContent('- Parent\n  - Child\n- Sibling\n');
		expect(await editor.getBlockKind(0)).toBe('list');
		expect(await editor.getBlockCount()).toBe(1);
	});

	test('editing item preserves source with correct marker', async () => {
		await editor.loadContent('- Item A\n- Item B\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Item A' });
		await first.click();
		await editor.typeText(' ok');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('- Item A ok');
		expect(source).toContain('- Item B');
	});

	test('nested item editing preserves indentation', async () => {
		await editor.loadContent('- Item\n  - Nested\n');
		const nested = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nested.first().click();
		await editor.typeText(' more');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('  - Nested more');
	});

	test('ordered list displays correct markers', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		expect(await editor.getBlockCount()).toBe(1);
		const source = await editor.getSource();
		expect(source).toBe('1. First\n2. Second\n3. Third\n');
	});
});

// ── Enter ───────────────────────────────────────────────────────────

test.describe('list Enter', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of item creates new sibling', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Alpha' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		const markers = (await editor.getSource()).match(/^- /gm) ?? [];
		expect(markers.length).toBeGreaterThanOrEqual(3);
	});

	test('Enter in middle of item splits content', async () => {
		await editor.loadContent('- HelloWorld\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'HelloWorld' });
		await item.click();
		// Place cursor between Hello and World (offset 5 from start of "HelloWorld")
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('- Hello');
		expect(source).toContain('- World');
	});

	test('Enter on empty only item exits list', async () => {
		await editor.loadContent('- Only\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Only' });
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Now in empty second item. Press Enter to exit.
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.typeText('After');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('Only');
		expect(source).toContain('After');
		// "After" should not be inside a list marker
		const afterIdx = source.indexOf('After');
		const lineStart = source.lastIndexOf('\n', afterIdx) + 1;
		expect(source.slice(lineStart, lineStart + 2)).not.toBe('- ');
	});

	test('Enter on empty first item creates paragraph before list', async () => {
		await editor.loadContent('- First\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Now empty first item. Go back to it.
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.typeText('Before');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source.indexOf('Before')).toBeLessThan(source.indexOf('First'));
	});

	test('Enter on empty middle item places cursor between siblings', async () => {
		await editor.loadContent('- First\n- Second\n- Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source.indexOf('Z')).toBeLessThan(source.indexOf('Third'));
	});

	test('Enter on empty item with nested content exits the list', async () => {
		await editor.loadContent('- Item\n  - Nested\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item' }).first();
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		// New item has empty paragraph + nested list. Press Enter.
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		const itemCount = (source.match(/^- /gm) || []).length;
		expect(itemCount).toBeLessThanOrEqual(2);
	});

	test('ordered: new item gets next number and subsequent renumber', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.typeText('New');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/2\.\s*New/);
		expect(source).toMatch(/3\.\s*Second/);
		expect(source).toMatch(/4\.\s*Third/);
	});

	test('ordered: Enter at start of first item numbers correctly', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// Should have 3 ordered items with sequential numbering
		expect(source).toMatch(/1\./);
		expect(source).toContain('First');
		// No duplicate numbers
		const numbers = (source.match(/^(\d+)\./gm) || []).map(Number);
		const unique = new Set(numbers);
		expect(unique.size).toBe(numbers.length);
	});
});

// ── Backspace ───────────────────────────────────────────────────────

test.describe('list Backspace', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace deletes empty first item', async () => {
		await editor.loadContent('- \n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]').first();
		await first.click();
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect((source.match(/^- /gm) || []).length).toBe(1);
		expect(source).toContain('Second');
	});

	test('Backspace at start of non-empty first item unwraps to a plain paragraph', async () => {
		await editor.loadContent('Before\n\n- Item one\n- Item two\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item one' });
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "Item one" should now be a plain paragraph, not a list item
		expect(source).toMatch(/^Item one/m);
		// "Item two" should still be a list item
		expect(source).toMatch(/^- Item two/m);
		// "Before" should still be present, unchanged (no auto-merge)
		expect(source).toContain('Before');
	});

	test('Backspace on single-item list (non-empty) removes the list entirely and lands cursor at the lifted paragraph', async () => {
		await editor.loadContent('- Solo\n');
		const item = editor.page.locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// List gone, plain paragraph remains
		expect(source).not.toMatch(/^- /m);
		expect(source).toContain('Solo');

		// Cursor at start of "Solo" — typing lands at start
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		const after = await editor.getSource();
		expect(after).toContain('ZSolo');
	});

	test('Backspace on first item with matching-type nested sub-list: nested items promote to parent list level', async () => {
		await editor.loadContent('- First\n  - Nested\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "First" is now a plain paragraph before the list
		expect(source).toMatch(/^First/m);
		// "Nested" and "Second" are both top-level list items
		expect(source).toMatch(/^- Nested/m);
		expect(source).toMatch(/^- Second/m);
	});

	test('Backspace on first item with mismatched-type nested sub-list: sub-list becomes separate block', async () => {
		await editor.loadContent('- First\n  1. OrderedNested\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "First" as plain paragraph
		expect(source).toMatch(/^First/m);
		// Ordered sub-list still exists as a top-level block
		expect(source).toMatch(/^1\. OrderedNested/m);
		// Unordered parent list still contains "Second"
		expect(source).toMatch(/^- Second/m);
	});

	test('Backspace on first item of ordered list: remaining items renumber from base', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "First" as plain paragraph, then ordered list with [Second=1, Third=2]
		expect(source).toMatch(/^First/m);
		expect(source).not.toMatch(/^1\. First/m);
		expect(source).toMatch(/^1\. Second/m);
		expect(source).toMatch(/^2\. Third/m);
	});

	test('Backspace deletes empty non-first item', async () => {
		await editor.loadContent('- First\n- Second\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Now in empty third item. Press Backspace.
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect((source.match(/^- /gm) || []).length).toBe(2);
	});

	test('Backspace at start of non-empty non-first item merges into previous item (rule B: deepest visible above)', async () => {
		await editor.loadContent('- Item one\n- Item two\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Item two' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "Item two" text should be merged into "Item one"
		expect(source).toContain('Item oneItem two');
		// Only one list item should remain
		expect((source.match(/^- /gm) ?? []).length).toBe(1);
	});

	test('M1 row 2: current item has nested sub-list; nested absorbed into target', async () => {
		await editor.loadContent('- A\n- B\n  - C\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Result: - AB\n  - C
		expect(source).toContain('- AB');
		expect(source).toMatch(/^\s+- C/m);
	});

	test('M1 row 3: target nested in previous item; current-item nested children become sibling of target (preserve absolute indent)', async () => {
		await editor.loadContent('- A\n  - AA\n- B\n  - C\n');
		const bItem = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await bItem.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Expected:
		//   - A
		//     - AAB
		//     - C
		expect(source).toContain('- A');
		expect(source).toMatch(/- AAB/);
		// C should now be at the same level as AAB (sibling in A's nested list)
		expect(source).toMatch(/- AAB\s*\n\s+- C/);
	});

	test('M1 row 4 (deep nesting): E preserves its original absolute depth of 1, sibling of B', async () => {
		const content = '- A\n  - B\n    - C\n- D\n  - E\n';
		await editor.loadContent(content);
		const dItem = editor.page.locator('[contenteditable="true"]', { hasText: 'D' }).first();
		await dItem.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Expected:
		//   - A
		//     - B
		//       - CD
		//     - E
		// Strong assertions: CD at depth 2 (4 spaces), B at depth 1 (2 spaces),
		// E also at depth 1 (2 spaces, sibling of B, not under CD).
		expect(source).toMatch(/^    - CD/m);
		expect(source).toMatch(/^  - B/m);
		expect(source).toMatch(/^  - E/m);
	});

	test('M1 row 5: current item has non-listItem continuation paragraph; absorbed into target item children', async () => {
		await editor.loadContent('- A\n- B\n\n  extra\n');
		const bItem = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await bItem.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Result: - AB with "extra" somewhere in the merged content
		expect(source).toContain('- AB');
		expect(source).toMatch(/extra/);
	});

	test('M1 ordered list: merged item deletion renumbers remaining', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// Result: 1. FirstSecond\n2. Third
		expect(source).toMatch(/^1\. FirstSecond/m);
		expect(source).toMatch(/^2\. Third/m);
	});

	test('M1 cursor lands at merge point in target', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const betaItem = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await betaItem.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		// Cursor should be at the merge point — between "Alpha" and "Beta"
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('AlphaZBeta');
	});

	test('Backspace at start of nested item promotes it', async () => {
		await editor.loadContent('- Parent\n  - Nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'Nested' });
		await nested.click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('- Parent\n- Nested\n');
	});

	test('Backspace on empty only item deletes the entire list', async () => {
		await editor.loadContent('Above\n\n- \n\nBelow\n');
		const item = editor.page.locator('[contenteditable="true"]').nth(1);
		await item.click();
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// The list should be gone entirely — no `- ` markers remain
		expect(source).not.toMatch(/^- /m);
		// And focus should be on the block before (Above)
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('AboveZ');
	});

	test('Backspace on empty only item when list is first block deletes the list', async () => {
		await editor.loadContent('- \n\nAfter\n');
		const item = editor.page.locator('[contenteditable="true"]').first();
		await item.click();
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// The list should be gone
		expect(source).not.toMatch(/^- /m);
		// "After" should still be present
		expect(source).toContain('After');
	});

	test('ordered: deleting item renumbers subsequent', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		// Empty item 3. Backspace to delete it.
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// Should still be 1, 2, 3 — no gaps
		expect(source).toMatch(/1\.\s*First/);
		expect(source).toMatch(/2\.\s*Second/);
		expect(source).toMatch(/3\.\s*Third/);
	});
});

// ── Tab (indent) ────────────────────────────────────────────────────

test.describe('list Tab', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab nests item under previous sibling', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(1).click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).toContain('- Item 1\n  - Item 2\n');
	});

	test('Tab on first item is no-op', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe('- Item 1\n- Item 2\n');
	});

	test('Tab keeps cursor in indented item', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const item2 = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await item2.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('ZItem 2');
	});

	test('Tab appends to existing nested list', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const item2 = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await item2.click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// Item 2 should now be after Nested in the same nested list
		expect(source).toContain('  - Nested\n  - Item 2');
	});

	test('ordered: Tab resets nested marker to 1', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// Nested item should start at 1, not keep its old number
		expect(source).toMatch(/\s+1\.\s*Second/);
		// Third should renumber to 2
		expect(source).toMatch(/^2\.\s*Third/m);
	});

	test('ordered: Tab appending to existing ordered nested list continues the sequence', async () => {
		await editor.loadContent('1. A\n   1. AA\n   2. AB\n2. B\n');
		const b = editor.page.locator('[contenteditable="true"]', { hasText: /^B$/ });
		await b.click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// B joins the existing nested list after AB; should become 3, not 1.
		expect(source).toMatch(/^\s+1\. AA$/m);
		expect(source).toMatch(/^\s+2\. AB$/m);
		expect(source).toMatch(/^\s+3\. B$/m);
		expect(source).not.toMatch(/^\s+1\. B$/m);
	});
});

// ── Shift+Tab (unindent) ────────────────────────────────────────────

test.describe('list Shift+Tab', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Tab promotes nested item', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const nested = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nested.first().click();
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).toContain('- Item 1\n- Nested\n- Item 2\n');
	});

	test('Shift+Tab on top-level item is no-op', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toBe('- Item 1\n- Item 2\n');
	});

	// Regression: promoteNestedItem must renumber both lists and normalize the
	// promoted item's marker when the parent and nested list types differ.

	test('ordered: promoting only nested item renumbers parent list', async () => {
		await editor.loadContent('1. First\n   1. Nested\n2. Second\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'Nested' });
		await nested.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toMatch(/^1\. First$/m);
		expect(source).toMatch(/^2\. Nested$/m);
		expect(source).toMatch(/^3\. Second$/m);
		// Nested list should be gone entirely.
		expect(source).not.toMatch(/^\s+\d+\./m);
	});

	test('ordered: promoting first of two nested items renumbers both lists', async () => {
		await editor.loadContent('1. P A\n   1. N A\n   2. N B\n2. P B\n');
		const na = editor.page.locator('[contenteditable="true"]', { hasText: 'N A' });
		await na.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toMatch(/^1\. P A$/m);
		// Remaining nested item must renumber from 2 to 1.
		expect(source).toMatch(/^\s+1\. N B$/m);
		expect(source).not.toMatch(/^\s+2\. N B$/m);
		// Promoted item lands between P A and P B; P B renumbers to 3.
		expect(source).toMatch(/^2\. N A$/m);
		expect(source).toMatch(/^3\. P B$/m);
	});

	test('ordered nested in unordered parent: promoted item takes unordered marker, nested remainder renumbers', async () => {
		await editor.loadContent('- P A\n  1. N1\n  2. N2\n- P B\n');
		const n1 = editor.page.locator('[contenteditable="true"]', { hasText: 'N1' });
		await n1.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// Remaining ordered nested list must renumber its sole item from 2 to 1.
		expect(source).toMatch(/^\s+1\. N2$/m);
		expect(source).not.toMatch(/^\s+2\. N2$/m);
		// Promoted item must adopt the unordered marker of its new parent.
		expect(source).toMatch(/^- N1$/m);
		expect(source).not.toMatch(/^\d+\. N1$/m);
		expect(source).toMatch(/^- P A$/m);
		expect(source).toMatch(/^- P B$/m);
	});

	test('unordered nested in ordered parent: promoted item takes ordered marker, parent renumbers', async () => {
		await editor.loadContent('1. P A\n   - N1\n   - N2\n2. P B\n');
		const n1 = editor.page.locator('[contenteditable="true"]', { hasText: 'N1' });
		await n1.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// Remaining unordered nested list keeps its marker style for N2.
		expect(source).toMatch(/^\s+- N2$/m);
		// Promoted item must adopt an ordered marker and slot at position 2.
		expect(source).toMatch(/^2\. N1$/m);
		expect(source).not.toMatch(/^- N1$/m);
		// Parent B renumbered from 2 to 3.
		expect(source).toMatch(/^3\. P B$/m);
	});
});

// ── Arrow key navigation ────────────────────────────────────────────

test.describe('list arrow navigation', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown from last item exits list to next block', async () => {
		await editor.loadContent('- Last item\n\nAfter.\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Last item' });
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('ZAfter.');
	});

	test('ArrowUp from first item exits list to previous block', async () => {
		await editor.loadContent('Before.\n\n- First item\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'First item' });
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('Before.Z');
	});

	test('ArrowLeft at start of item content moves to end of previous item', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowLeft');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// "Z" lands at end of Alpha (the target of ArrowLeft from start of Beta)
		expect(await editor.getSource()).toContain('- AlphaZ\n- Beta');
	});

	test('ArrowRight at end of item content moves to start of next item', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Alpha' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowRight');
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		// "Z" lands at start of Beta
		expect(await editor.getSource()).toContain('- Alpha\n- ZBeta');
	});
});

test.describe('cross-container merge on Backspace (list prev)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('flat unordered list: Backspace at start of following paragraph merges into last item', async () => {
		await editor.loadContent('- first\n- second\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^- secondtext$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('flat ordered list: Backspace at start of following paragraph merges into last item without renumbering', async () => {
		await editor.loadContent('1. first\n2. second\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^1\. first$/m);
		expect(source).toMatch(/^2\. secondtext$/m);
	});

	test('nested list: merge recurses into deepest nested item paragraph', async () => {
		await editor.loadContent('- a\n  - b\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^- a$/m);
		expect(source).toMatch(/^\s+- btext$/m);
	});

	test('list inside blockquote: merge recurses through both containers', async () => {
		await editor.loadContent('> - item\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('> - itemtext');
		expect(source).not.toMatch(/^text$/m);
	});

	test('list with opaque deepest leaf: fall back to move-focus', async () => {
		await editor.loadContent('- item\n\n  ```\n  code\n  ```\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		// No merge — the list item and the following paragraph stay separate
		const source = await editor.getSource();
		expect(source).toMatch(/^text$/m);
		expect(source).toContain('code');
	});
});
