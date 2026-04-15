/**
 * List Tab + Shift+Tab tests — change nesting level.
 * Requirements: e2e/requirements/blocks/list-indent.md
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

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

	// Regression: after Shift+Tab promotes a nested item to the outer list,
	// ArrowUp from the promoted item must move focus into the previous
	// (outer-list) item. A stale-refs bug in promoteNestedItem could leave
	// the outer list's ref/id state out of sync, making ArrowUp a no-op.
	test('ordered: ArrowUp after Shift+Tab moves caret into previous outer item', async () => {
		await editor.loadContent('1. one\n   1. two\n2. three\n');
		const two = editor.page.locator('[contenteditable="true"]', { hasText: 'two' });
		await two.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.page.waitForTimeout(300);
		// Sanity: promote renumbered the outer list.
		const afterPromote = await editor.getSource();
		expect(afterPromote).toMatch(/^1\. one$/m);
		expect(afterPromote).toMatch(/^2\. two$/m);
		expect(afterPromote).toMatch(/^3\. three$/m);
		// Now ArrowUp from promoted "two" should land in "one".
		// Type marker Z at the landing position and assert it appears inside
		// the "one" item, not inside "two".
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(100);
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^1\. .*Z.*one|^1\. oneZ/m);
		expect(source).not.toMatch(/^2\. .*Z.*two|^2\. Ztwo/m);
	});
});
