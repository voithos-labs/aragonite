import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The right-click menu's Cut and Copy write what Ctrl+X and Ctrl+C write for the same selection.
// Requirements: `e2e/requirements/clipboard/menu-clipboard.md`.

const BLOCKS = [
	{ name: 'a paragraph', doc: 'abcd efgh\n', start: 0, left: ' efgh\n' },
	{ name: 'a code block', doc: '```\nabcd efgh\n```\n', start: 4, left: '```\n efgh\n```\n' }
];

/** Selects `abcd` by keyboard from `start`, then right-clicks inside the selection. */
async function openMenuOverSelection(editor: EditorPage, start: number): Promise<void> {
	await editor.focusBlock(0, start);
	for (let i = 0; i < 4; i++) await editor.page.keyboard.press('Shift+ArrowRight');
	const box = await editor.page.evaluate(() => {
		const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	});
	await editor.page.mouse.click(box.x, box.y, { button: 'right' });
	await expect(editor.page.getByRole('menu', { name: 'Block actions' })).toBeVisible();
}

test.describe('the right-click menu’s clipboard rows', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.seedClipboard('');
	});

	for (const block of BLOCKS) {
		test(`Cut in ${block.name} puts the selection on the clipboard and removes it`, async ({
			page
		}) => {
			await editor.loadContent(block.doc);
			await openMenuOverSelection(editor, block.start);

			await page.getByRole('menuitem', { name: 'Cut' }).click();

			await editor.bridge.waitForSourceEquals(block.left);
			expect(await editor.readClipboard()).toBe('abcd');
		});

		test(`Copy in ${block.name} puts the selection on the clipboard and leaves the bytes`, async ({
			page
		}) => {
			await editor.loadContent(block.doc);
			await openMenuOverSelection(editor, block.start);

			await page.getByRole('menuitem', { name: 'Copy' }).click();

			await expect.poll(() => editor.readClipboard()).toBe('abcd');
			expect(await editor.bridge.getSource()).toBe(block.doc);
		});
	}
});
