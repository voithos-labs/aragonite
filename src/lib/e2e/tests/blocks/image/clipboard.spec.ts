import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Selected image-widget copy/cut (requirements/blocks/image/clipboard.md). The
// widget is selected via the ArrowLeft boundary gesture, which keeps a collapsed
// caret in the prose contenteditable — so Ctrl+C/Ctrl+X fire real copy/cut events
// that reach the block's clipboard handlers (setData, the house-rule sync path).

const IMG_MD = '![cat](/test-fixtures/sample.png)';
const DOC = `lead${IMG_MD}\n`;

test.describe('selected image-widget copy/cut', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	const overlay = () => editor.page.locator('[data-image-overlay]');
	const readClipboard = () => editor.page.evaluate(() => navigator.clipboard.readText());

	async function selectWidget(): Promise<void> {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowLeft');
		await expect(overlay()).toBeVisible();
	}

	test('Mod+C copies the widget markdown; document and selection survive', async () => {
		await selectWidget();
		const before = await editor.bridge.getSource();
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		expect(await readClipboard()).toBe(IMG_MD);
		expect(await editor.bridge.getSource()).toBe(before);
		await expect(overlay()).toBeVisible();
	});

	test('Mod+X copies the slice, removes it as one commit, and undo restores it', async () => {
		const before = await editor.bridge.getSource();
		await selectWidget();
		await editor.page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();
		expect(await readClipboard()).toBe(IMG_MD);
		await editor.bridge.waitForSourceNotContains('sample.png');
		expect((await editor.bridge.getSource()).trim()).toBe('lead');
		await expect(overlay()).toHaveCount(0);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});
});
