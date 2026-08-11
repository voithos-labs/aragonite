import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

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
		await editor.bridge.waitForSourceContains('- Item 1\n  - Item 2\n');
		expect(await editor.bridge.getSource()).toContain('- Item 1\n  - Item 2\n');
	});

	test('Tab on first item is no-op', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Tab');
		// no-op assertion — yield for any potential structural change to fire and reach the source.
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- Item 1\n- Item 2\n');
	});

	test('Tab keeps cursor in indented item', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const item2 = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await item2.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('ZItem 2');
		expect(await editor.bridge.getSource()).toContain('ZItem 2');
	});

	test('Tab appends to existing nested list', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const item2 = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await item2.click();
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceContains('  - Nested\n  - Item 2');
		const source = await editor.bridge.getSource();
		expect(source).toContain('  - Nested\n  - Item 2');
	});

	test('ordered: Tab resets nested marker to 1', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceMatches(/\s+1\.\s*Second/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/\s+1\.\s*Second/);
		expect(source).toMatch(/^2\.\s*Third/m);
	});

	test('ordered: Tab appending to existing ordered nested list continues the sequence', async () => {
		await editor.loadContent('1. A\n   1. AA\n   2. AB\n2. B\n');
		const b = editor.page.locator('[contenteditable="true"]', { hasText: /\. B$/ });
		await b.click();
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceMatches(/^\s+3\. B$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^\s+1\. AA$/m);
		expect(source).toMatch(/^\s+2\. AB$/m);
		expect(source).toMatch(/^\s+3\. B$/m);
		expect(source).not.toMatch(/^\s+1\. B$/m);
	});

	// indentItem cascades focus(-1) to the leaf paragraph, and a leaf passing -1 straight to
	// cursor.setRaw throws IndexSizeError and silently no-ops. Only a cascade target with
	// ambient = "" — not the first child of its list-item — reaches it, hence the extra paragraph.
	test('Tab cascades cursor to start of moved item continuation paragraph', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n\n  continuation\n');
		// Item 2 is the second listItem at path [0, 1]; its first paragraph is the "Item 2" line,
		// so Tab there nests the whole multi-paragraph item under Item 1.
		await editor.focusBlockAtPath([0, 1, 0], 0);
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceMatches(/^\s+- Item 2/m);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!continuation');
		const source = await editor.bridge.getSource();
		expect(source).toContain('!continuation');
		expect(source).not.toContain('continuation!');
	});
});
