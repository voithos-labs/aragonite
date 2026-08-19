import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('list rendering', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('nested list renders as single top-level block', async () => {
		await editor.loadContent('- Parent\n  - Child\n- Sibling\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('list');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('editing item preserves source with correct marker', async () => {
		await editor.loadContent('- Item A\n- Item B\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Item A' });
		await first.click();
		await editor.typeText(' ok');
		await editor.bridge.waitForSourceContains('- Item A ok');
		expect(await editor.bridge.getSource()).toContain('- Item B');
	});

	test('nested item editing preserves indentation', async () => {
		await editor.loadContent('- Item\n  - Nested\n');
		const nested = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nested.first().click();
		await editor.typeText(' more');
		await editor.bridge.waitForSourceContains('  - Nested more');
	});

	test('ordered list displays correct markers', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);
		const source = await editor.bridge.getSource();
		expect(source).toBe('1. First\n2. Second\n3. Third\n');
	});
});

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
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^[^-].*Z/m);
	});

	test('ArrowUp from first item exits list to previous block', async () => {
		await editor.loadContent('Before.\n\n- First item\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'First item' });
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('Before.Z');
	});

	test('ArrowLeft at start of item content moves to end of previous item', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowLeft');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('- AlphaZ\n- Beta');
	});

	test('ArrowRight at end of item content moves to start of next item', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Alpha' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowRight');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('- Alpha\n- ZBeta');
	});
});
