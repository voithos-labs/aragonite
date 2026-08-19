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
	});

	test('Tab on first item is no-op', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Tab');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('- Item 1\n- Item 2\n');
	});

	test('Tab appends to existing nested list', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const item2 = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await item2.click();
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceContains('  - Nested\n  - Item 2');
	});

	test('ordered: Tab resets nested marker to 1', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Tab');
		await editor.bridge.waitForSourceMatches(/\s+1\.\s*Second/);
		expect(await editor.bridge.getSource()).toMatch(/^2\.\s*Third/m);
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
		expect(await editor.bridge.getSource()).not.toContain('continuation!');
	});

	// Focus must follow the item THROUGH the container mutation: the moved item's ref is the one
	// `indentItem` focuses, and typing is the only oracle that tells it from a stale pre-move ref.
	test('Tab into an existing nested list focuses the moved item', async () => {
		await editor.loadContent('- one\n- two\n  - nested under two\n- three\n');

		const three = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await three.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('Xthree');

		const src = await editor.bridge.getSource();
		expect(src).toContain('- nested under two');
		// Nesting, not just the typed char: bare 'Xthree' also passes when Tab
		// no-ops and only the typing lands.
		expect(src).toMatch(/^ {2}- Xthree$/m);
	});

	test('Tab into a fresh nested list focuses the moved item', async () => {
		await editor.loadContent('- one\n- two\n- three\n');

		const two = editor.page.locator('[contenteditable="true"]', { hasText: /two$/ });
		await two.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');

		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/- one\n {2}- Xtwo/);
	});
});
