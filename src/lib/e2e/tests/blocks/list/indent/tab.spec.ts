import { test, expect } from '@playwright/test';
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
		await editor.page.waitForTimeout(300);
		expect(await editor.bridge.getSource()).toContain('- Item 1\n  - Item 2\n');
	});

	test('Tab on first item is no-op', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- Item 1\n- Item 2\n');
	});

	test('Tab keeps cursor in indented item', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const item2 = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await item2.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('ZItem 2');
		expect(await editor.bridge.getSource()).toContain('ZItem 2');
	});

	test('Tab appends to existing nested list', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const item2 = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 2' });
		await item2.click();
		await editor.page.keyboard.press('Tab');
		await editor.page.waitForTimeout(300);
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
		await editor.bridge.waitForSourceMatches(/^\s+1\. AA$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^\s+1\. AA$/m);
		expect(source).toMatch(/^\s+2\. AB$/m);
		expect(source).toMatch(/^\s+3\. B$/m);
		expect(source).not.toMatch(/^\s+1\. B$/m);
	});
});
