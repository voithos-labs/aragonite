/**
 * List Backspace tests — delete, merge, promote, and Delete-at-end.
 * Requirements: e2e/requirements/blocks/list-backspace.md
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

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

	// Forge-review H6: the requirements file specifies "Delete at end of
	// last child within an item: delegates to parent (same as paragraph
	// behavior)". Symmetric with cross-container merge via Backspace.
	test('Delete at end of last item merges following paragraph into the last item', async () => {
		await editor.loadContent('- first\n- last item\n\nAfter\n');
		const last = editor.page.locator('[contenteditable="true"]', { hasText: 'last item' });
		await last.click();
		await editor.page.keyboard.press('End');
		await editor.pressKey('Delete');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^- last itemAfter$/m);
		expect(source).not.toMatch(/^After$/m);
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
