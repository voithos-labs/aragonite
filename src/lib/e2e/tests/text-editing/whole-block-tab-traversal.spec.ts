import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { wholeBlockInput } from '../../whole-block-input';

// Requirements: e2e/requirements/text-editing/whole-block-tab-traversal.md.

const DOC = 'Before\n\n---\n\nAfter\n';

const rule = (editor: EditorPage) => editor.page.locator('.thematic-break-block');

/** The block path behind DOM focus — a tab landing INSIDE the block still reports `[1]`. */
function focusedBlockPath(editor: EditorPage): Promise<string | null> {
	return editor.page.evaluate(
		() =>
			document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path') ?? null
	);
}

async function focusTheRule(editor: EditorPage): Promise<void> {
	await editor.focusBlockStart(2);
	await editor.page.keyboard.press('Backspace');
	await expect(wholeBlockInput(rule(editor))).toBeFocused();
}

test.describe('whole-block focus — the block is one tab stop', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	test('Shift+Tab leaves the block in one press', async ({ page }) => {
		await focusTheRule(editor);

		await page.keyboard.press('Shift+Tab');

		await expect.poll(() => focusedBlockPath(editor)).toBe('[0]');
	});

	test('Tab leaves the block in one press', async ({ page }) => {
		await focusTheRule(editor);

		await page.keyboard.press('Tab');

		await expect.poll(() => focusedBlockPath(editor)).toBe('[2]');
	});

	// Tab itself never navigates out of a paragraph — `block.insertTab` types one — so the
	// backward press is the only way a tab reaches the block from a neighbour.
	test('Shift+Tab from the paragraph below lands on the editing host, not the separator', async ({
		page
	}) => {
		await editor.focusBlockStart(2);

		await page.keyboard.press('Shift+Tab');

		await expect(wholeBlockInput(rule(editor))).toBeFocused();
	});
});
