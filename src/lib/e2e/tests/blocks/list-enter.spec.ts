/**
 * List Enter key tests — new item, split, and exit behaviors.
 * Requirements: e2e/requirements/blocks/list-enter.md
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

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

	test('Enter on empty item with nested content promotes nested items instead of dropping them', async () => {
		await editor.loadContent('- Item\n  - Nested\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item' }).first();
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		// New item has empty paragraph + nested list. Press Enter — the
		// nested list items must be promoted to sibling level rather than
		// silently dropped by the exit-list path.
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		expect(source).toContain('Item');
		expect(source).toContain('Nested');
		// Nested must now sit at the outer-list indent.
		expect(source).toMatch(/^- Nested$/m);
		// And it must NOT be at the nested indent anymore.
		expect(source).not.toMatch(/^ {2,}- Nested$/m);
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

	// Regression: Enter inside an empty first item of an ordered list must
	// (a) exit the list by creating a paragraph before it and (b) renumber
	// the remaining items starting at 1. exitListAtItem deletes the item
	// but must also call renumberOrderedList.
	test('ordered: Enter on empty first item renumbers remaining list', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		// Blank the first item in place so the caret sits in an empty "1. " item
		// without creating an extra item via Enter.
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		// Press Enter on the now-empty first item — should exit the list.
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// "Second" remains but is now the sole item and must be renumbered to 1.
		expect(source).toMatch(/^1\. Second$/m);
		expect(source).not.toMatch(/^2\. Second$/m);
	});

	// Covers the requirement "Empty last item: deleted, paragraph created
	// after the list" — pressing Enter on an empty final list item removes
	// that item and drops a plain paragraph below the list.
	test('Enter on empty last item creates paragraph after the list', async () => {
		await editor.loadContent('- First\n- Last\n');
		const last = editor.page.locator('[contenteditable="true"]', { hasText: 'Last' });
		await last.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		await editor.typeText('After');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// First is still a list item; "After" is a plain paragraph following the list
		expect(source).toMatch(/^- First$/m);
		expect(source).not.toMatch(/^- Last/m);
		expect(source).toContain('After');
		expect(source.indexOf('After')).toBeGreaterThan(source.indexOf('First'));
	});
});
