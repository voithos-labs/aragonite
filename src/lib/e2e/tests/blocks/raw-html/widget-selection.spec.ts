import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { textRunEnd } from '../../../text-runs';

// A live `<br>` selected whole grows a Shift+click range from its edge, as a selected image does.
test.describe('a live `<br>` selected whole', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// ArrowRight from the caret at the `<br>`'s start selects it, entered at raw 6.
	async function selectBreak(): Promise<void> {
		await editor.focusBlock(0, 6);
		await editor.page.keyboard.press('ArrowRight');
		await expect(editor.page.locator('.md-br-widget')).toHaveCount(1);
	}

	async function shiftClickAt(point: { x: number; y: number }): Promise<void> {
		await editor.page.keyboard.down('Shift');
		await editor.page.mouse.click(point.x, point.y);
		await editor.page.keyboard.up('Shift');
	}

	test('Shift+click after it in its block selects from its start to the press', async ({
		page
	}) => {
		await editor.loadContent('before<br>after text here\n');
		await selectBreak();
		await shiftClickAt(await textRunEnd(page, 'here'));
		await page.keyboard.type('Z');
		await expect.poll(() => editor.bridge.getSource()).toBe('beforeZ\n');
	});

	test('Shift+click in the next block selects from its start into that block', async ({ page }) => {
		await editor.loadContent('before<br>after\n\nnext line\n');
		await selectBreak();
		await shiftClickAt(await textRunEnd(page, 'line', { path: [1] }));
		await expect
			.poll(() => editor.bridge.getSelection())
			.toMatchObject({ anchor: { path: [0], offset: 6 }, focus: { path: [1] } });
	});
});
