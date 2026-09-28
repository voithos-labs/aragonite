import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { wholeBlockInput } from '../../whole-block-input';

// Where the caret goes once a block focused as a whole is deleted: the side the key points.
// Requirements: `requirements/blocks/whole-block-delete-landing.md`.

const DOC = 'a\n\n---\n\nb\n';

test.describe('whole-block delete: where the caret goes after the block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowDown');
		await expect(wholeBlockInput(page.locator('.thematic-break-block'))).toBeFocused();
	});

	test('Backspace lands at the end of the block above', async ({ page }) => {
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('---');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('ax\n\nb\n');
	});

	test('Delete lands at the start of the block below', async ({ page }) => {
		await page.keyboard.press('Delete');
		await editor.bridge.waitForSourceNotContains('---');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('a\n\nxb\n');
	});

	test('cut lands at the start of the block below', async ({ page }) => {
		await page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceNotContains('---');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('a\n\nxb\n');
	});
});
