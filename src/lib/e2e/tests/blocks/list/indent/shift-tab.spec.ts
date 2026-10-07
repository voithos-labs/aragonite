import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// What the lifted item carries and how markers and numbers settle are pinned in
// `lift-keeps-order.test.ts`; these rows keep the caret and the emptied-parent cases.
test.describe('list Shift+Tab', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Tab on the one item of an item’s only list removes the emptied item', async () => {
		await editor.loadContent('- - a\n');
		const nested = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nested.first().click();
		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceEquals('- a\n');
		await editor.page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('- xa\n');
	});

	test('Shift+Tab on top-level item is no-op', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(0).click();
		await editor.pressDeclined('Shift+Tab');
		expect(await editor.bridge.getSource()).toBe('- Item 1\n- Item 2\n');
	});

	// Stale outer-list refs after `promoteNestedItem` would make ArrowUp do nothing.
	test('ordered: ArrowUp after Shift+Tab moves caret into previous outer item', async () => {
		await editor.loadContent('1. one\n   1. two\n2. three\n');
		const two = editor.page.locator('[contenteditable="true"]', { hasText: 'two' });
		await two.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceMatches(/^2\. two$/m);
		const afterPromote = await editor.bridge.getSource();
		expect(afterPromote).toMatch(/^1\. one$/m);
		expect(afterPromote).toMatch(/^3\. three$/m);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^1\. .*Z.*one|^1\. oneZ/m);
		expect(await editor.bridge.getSource()).not.toMatch(/^2\. .*Z.*two|^2\. Ztwo/m);
	});

	// Focus must follow the item through the container's change: `promoteNestedItem` focuses the
	// promoted item's ref, and typing is the only way to tell that from a stale ref.
	test('Shift+Tab promoting one of several nested items focuses the promoted item', async () => {
		await editor.loadContent('- one\n  - nested a\n  - nested b\n- three\n');

		const nestedA = editor.page.locator('[contenteditable="true"]', { hasText: 'nested a' });
		await nestedA.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');

		await editor.typeText('X');
		await editor.bridge.waitForSourceEquals('- one\n- Xnested a\n  - nested b\n- three\n');
	});

	test('Shift+Tab of the only nested item removes the nested list and focuses the promoted item', async () => {
		await editor.loadContent('- one\n  - lonely nested\n- three\n');

		const lonely = editor.page.locator('[contenteditable="true"]', { hasText: 'lonely nested' });
		await lonely.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+Tab');

		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/- one\n- Xlonely nested\n- three/);
		expect(await editor.bridge.getSource()).not.toMatch(/- one\n {2}-\s*\n/);
	});
});
