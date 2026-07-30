import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('blockquote editing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('blockquote content is editable and source keeps > prefix', async () => {
		await editor.loadContent('> Hello world\n');
		const bq = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bq.click();
		await editor.typeText(' again');
		await editor.bridge.waitForSourceMatches(/^> .*Hello world again/m);
		expect(await editor.bridge.getSource()).toMatch(/^> .*Hello world again/m);
	});

	test('blockquote source round-trips after editing', async () => {
		await editor.loadContent('> First line\n>\n> Second line\n');
		const inner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await inner.click();
		await editor.typeText(' appended');
		await editor.bridge.waitForSourceContains('First line appended');
		const source = await editor.bridge.getSource();
		expect(source).toContain('> ');
		expect(source).toContain('First line appended');
		expect(source).toContain('Second line');
	});

	test('blockquote with multiple paragraphs edits correctly', async () => {
		await editor.loadContent('> Para one\n>\n> Para two\n');
		const editables = editor.getBlock(0).locator('[contenteditable="true"]');
		expect(await editables.count()).toBeGreaterThanOrEqual(2);
		await editables.nth(1).click();
		await editor.typeText(' plus');
		await editor.bridge.waitForSourceContains('Para two plus');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Para two plus');
		expect(source).toMatch(/^> /m);
	});

	test('blockquote exit via double-Enter keeps caret visible', async () => {
		await editor.loadContent('> Line one.\n>\n> Line two.\n');
		const editables = editor.getBlock(0).locator('[contenteditable="true"]');
		await editables.last().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// The split's blank-line separator plus the empty paragraph it made.
		await editor.bridge.waitForSourceMatches(/> Line two\.\n>\n>\n$/);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/> Line two\.\n\n/);
		await editor.typeText('After quote');
		await editor.bridge.waitForSourceContains('After quote');
		expect(await editor.bridge.getSource()).toContain('After quote');
	});
});
