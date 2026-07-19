import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

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
		await editor.bridge.waitForSourceContains('- Item 1\n- Nested\n- Item 2\n');
		expect(await editor.bridge.getSource()).toContain('- Item 1\n- Nested\n- Item 2\n');
	});

	test('Shift+Tab on top-level item is no-op', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.page.keyboard.press('Shift+Tab');
		// no-op assertion — yield for any potential structural change to fire and reach the source.
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- Item 1\n- Item 2\n');
	});

	test('ordered: promoting only nested item renumbers parent list', async () => {
		await editor.loadContent('1. First\n   1. Nested\n2. Second\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'Nested' });
		await nested.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceMatches(/^1\. First$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. First$/m);
		expect(source).toMatch(/^2\. Nested$/m);
		expect(source).toMatch(/^3\. Second$/m);
		expect(source).not.toMatch(/^\s+\d+\./m);
	});

	test('ordered: promoting first of two nested items renumbers both lists', async () => {
		await editor.loadContent('1. P A\n   1. N A\n   2. N B\n2. P B\n');
		const na = editor.page.locator('[contenteditable="true"]', { hasText: 'N A' });
		await na.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceMatches(/^1\. P A$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. P A$/m);
		expect(source).toMatch(/^\s+1\. N B$/m);
		expect(source).not.toMatch(/^\s+2\. N B$/m);
		expect(source).toMatch(/^2\. N A$/m);
		expect(source).toMatch(/^3\. P B$/m);
	});

	test('ordered nested in unordered parent: promoted item takes unordered marker, nested remainder renumbers', async () => {
		await editor.loadContent('- P A\n  1. N1\n  2. N2\n- P B\n');
		const n1 = editor.page.locator('[contenteditable="true"]', { hasText: 'N1' });
		await n1.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceMatches(/^\s+1\. N2$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^\s+1\. N2$/m);
		expect(source).not.toMatch(/^\s+2\. N2$/m);
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
		await editor.bridge.waitForSourceMatches(/^\s+- N2$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^\s+- N2$/m);
		expect(source).toMatch(/^2\. N1$/m);
		expect(source).not.toMatch(/^- N1$/m);
		expect(source).toMatch(/^3\. P B$/m);
	});

	// Regression: stale outer-list refs after promoteNestedItem could make ArrowUp a no-op.
	test('ordered: ArrowUp after Shift+Tab moves caret into previous outer item', async () => {
		await editor.loadContent('1. one\n   1. two\n2. three\n');
		const two = editor.page.locator('[contenteditable="true"]', { hasText: 'two' });
		await two.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceMatches(/^1\. one$/m);
		const afterPromote = await editor.bridge.getSource();
		expect(afterPromote).toMatch(/^1\. one$/m);
		expect(afterPromote).toMatch(/^2\. two$/m);
		expect(afterPromote).toMatch(/^3\. three$/m);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^1\. .*Z.*one|^1\. oneZ/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. .*Z.*one|^1\. oneZ/m);
		expect(source).not.toMatch(/^2\. .*Z.*two|^2\. Ztwo/m);
	});
});
