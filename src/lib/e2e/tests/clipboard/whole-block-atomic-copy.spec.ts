import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Whole-block atomic copy/cut through the shared handleWholeBlockKeys tail
// (requirements/clipboard/whole-block-atomic-copy.md). Thematic break is the
// built-in whole-block-focus surface; the mermaid container-factory caller is
// pinned separately in plugins/mermaid-focus. Mod+C writes via
// navigator.clipboard.writeText (no ClipboardEvent on the keydown path), so the
// only observable signal for copy is the clipboard content itself.

const DOC = 'above\n\n---\n\nbelow\n';
const BREAK_MD = '---';

test.describe('whole-block atomic copy/cut — thematic break', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	const breakBlock = () => editor.page.locator('.thematic-break-block');
	const readClipboard = () => editor.page.evaluate(() => navigator.clipboard.readText());

	async function focusBreakByArrow(): Promise<void> {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await expect(breakBlock()).toBeFocused();
	}

	test('Mod+C copies the block markdown and leaves the document unchanged', async () => {
		await focusBreakByArrow();
		const before = await editor.bridge.getSource();
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		expect(await readClipboard()).toBe(BREAK_MD);
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('Mod+X copies the markdown, deletes the block, and one undo restores it', async () => {
		const before = await editor.bridge.getSource();
		await focusBreakByArrow();
		await editor.page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();
		expect(await readClipboard()).toBe(BREAK_MD);
		await editor.bridge.waitForSourceNotContains('---');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});

	test('reading mode: Mod+C copies; Mod+X copies but deletes nothing', async ({ page }) => {
		await page.getByTestId('presentation-toggle').click();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await breakBlock().click();
		await expect(breakBlock()).toBeFocused();
		const before = await editor.bridge.getSource();

		await page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		expect(await readClipboard()).toBe(BREAK_MD);

		await page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();
		expect(await readClipboard()).toBe(BREAK_MD);
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
