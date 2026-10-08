import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// `editor.insertMarkdown()`: the paste path entered without a clipboard
// (`requirements/clipboard/insert-markdown-door.md`). Each case asserts the outcome the same
// bytes pasted at the same caret produce, since that parity is the whole contract.

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

test.describe('insertMarkdown: programmatic insertion', () => {
	let editor: EditorPage;

	const insert = (md: string): Promise<boolean> =>
		editor.page.evaluate(
			(text) => (window as any).__test.insertMarkdown(text) as Promise<boolean>,
			md
		);

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a table at a paragraph caret splices structurally, focus at the end of the insertion', async () => {
		await editor.loadContent('before\n\nafter\n');
		await editor.focusBlockEnd(0);

		expect(await insert(TABLE)).toBe(true);
		await editor.bridge.waitForSourceContains('| --- | --- |');
		expect(await editor.bridge.getBlockKind(1)).toBe('table');

		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/\| 1 \| 2X \|/);
	});

	// The structural strategy splices the parent's children itself, a third write that can put a
	// block in a to-do's first position, where the task marker cannot stand in front of it.
	test('a table over a to-do paragraph takes the checkbox with the paragraph', async () => {
		await editor.loadContent('- [ ] alpha\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.page.keyboard.press('Shift+End');

		expect(await insert(TABLE)).toBe(true);
		await editor.bridge.waitForSourceContains('| --- | --- |');
		expect(await editor.bridge.getSource()).not.toContain('[ ]');
		await expect(editor.page.locator('.task-checkbox')).toHaveCount(0);
	});

	// A widget-only paragraph holds no native selection, so the browser sends clipboard events to
	// `<body>`; the block still holds DOM focus, so the call must reach the paste's widget branch.
	test('a selected inline widget is replaced, as pasting over it does', async () => {
		await editor.loadContent('lead\n\n![cat](/test-fixtures/sample.png)\n\ntail\n');
		await editor.page.locator('[data-image-widget]').click();
		await expect(editor.page.locator('[data-image-overlay]')).toBeVisible();

		expect(await insert('REPLACED')).toBe(true);
		await editor.bridge.waitForSourceContains('REPLACED');
		expect(await editor.bridge.getSource()).not.toContain('sample.png');
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});

	// Miss-analysis: no case drove a cell's `publishRefSlot`, and G4.38 reads only instance exports.
	test('a focused table cell takes the entry point through its published ref slot', async () => {
		await editor.loadContent(TABLE);
		await editor.page.locator('.table-cell').nth(3).click();
		await editor.page.keyboard.press('End');

		expect(await insert('ZZ')).toBe(true);
		await editor.bridge.waitForSourceContains('| 2ZZ |');
	});
});
