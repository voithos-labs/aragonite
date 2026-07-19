import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('sticky column: rapid cross-block navigation (timing)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Regression: isAtFirstVisualLine / isAtLastVisualLine missed the boundary signal
	// under rapid input when firstChild/lastChild is a non-text node (heading markers,
	// inline markup spans), causing the native arrow to clamp within the same block.

	test('rapid ArrowUp across headings crosses to the first heading', async () => {
		await editor.loadContent('# Heading 1\n\n## Heading 2\n\n### Heading 3\n');
		const h3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await h3.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowUp');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		const lines = source.split('\n');
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across headings crosses to the last heading', async () => {
		await editor.loadContent('# Heading 1\n\n## Heading 2\n\n### Heading 3\n');
		const h1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await h1.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		const lines = source.split('\n');
		expect(lines[4]).toContain('X');
	});

	test('rapid ArrowUp across plain paragraphs crosses to the first', async () => {
		await editor.loadContent('Para one.\n\nPara two.\n\nPara three.\n');
		const p3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await p3.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowUp');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		const lines = source.split('\n');
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across plain paragraphs crosses to the last', async () => {
		await editor.loadContent('Para one.\n\nPara two.\n\nPara three.\n');
		const p1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await p1.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		const lines = source.split('\n');
		expect(lines[4]).toContain('X');
	});

	test('rapid ArrowUp across paragraphs whose first child is a markup span', async () => {
		// firstChild is the dimmed `**` marker span — exercises the same isAtFirstVisualLine path as headings.
		await editor.loadContent(
			'**bold one** rest of para.\n\n**bold two** rest of para.\n\n**bold three** rest of para.\n'
		);
		const p3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await p3.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowUp');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		const lines = source.split('\n');
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across paragraphs whose last child is a markup span', async () => {
		// lastChild is the dimmed `**` marker span — exercises the isAtLastVisualLine path.
		await editor.loadContent(
			'rest of para **bold one**\n\nrest of para **bold two**\n\nrest of para **bold three**\n'
		);
		const p1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await p1.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		const lines = source.split('\n');
		expect(lines[4]).toContain('X');
	});
});
