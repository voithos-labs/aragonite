import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('live raw-HTML widget paste-while-selected', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste while <br> widget selected replaces widget bytes with pasted text', async ({
		page
	}) => {
		await editor.loadContent('before<br>after\n');
		// Caret at widget.start; ArrowRight enters widget selection via the
		// atRight=false branch (TextEditableBlock.svelte) with preSelectOffset = 6.
		await editor.focusBlock(0, 6);
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('.md-br-widget')).toHaveCount(1);

		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.setData('text/plain', 'REPLACED');
			document.activeElement?.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
			);
		});

		await editor.bridge.waitForSourceContains('beforeREPLACEDafter');
		const src = await editor.bridge.getSource();
		expect(src).not.toContain('<br>');
		expect(src).not.toMatch(/^REPLACEDbefore/);
	});

	test('undo after paste-replace restores the <br> and the caret at preSelectOffset', async ({
		page
	}) => {
		await editor.loadContent('before<br>after\n');
		await editor.focusBlock(0, 6);
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('.md-br-widget')).toHaveCount(1);

		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.setData('text/plain', 'REPLACED');
			document.activeElement?.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
			);
		});
		await editor.bridge.waitForSourceContains('beforeREPLACEDafter');

		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceContains('<br>');

		// Typing must land at offset 6 (preSelectOffset), not at the far widget boundary;
		// keyboard.press fires the CST keydown intercept that routes the character through the
		// widget-adjacency branch.
		await page.keyboard.press('X');
		await editor.bridge.waitForSourceContains('beforeX');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/^beforeX<br>after/);
	});
});
