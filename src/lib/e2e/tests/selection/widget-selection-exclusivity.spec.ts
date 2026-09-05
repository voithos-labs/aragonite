import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A widget's keydown handler declines modifier chords, so Mod+A reaches the ordinary
// select-all and the second press goes document-wide while the widget is still selected
// (requirements/selection/widget-selection-exclusivity.md). The document ends with the
// widget's paragraph, so the range's focus endpoint hosts no caret and the chord dispatches
// at <body>, where the editor root's widget arm and cross-block arm see the same event.

const IMG_MD = '![cat](/test-fixtures/sample.png)';
const DOC = `lead\n\n${IMG_MD}\n`;

test.describe('widget selection ends when a cross-block range opens', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		// The clipboard outlives the browser context, so a chord that writes nothing would
		// otherwise read back the previous case's payload.
		await editor.seedClipboard('SENTINEL');
	});

	const overlay = () => editor.page.locator('[data-image-overlay]');

	async function selectWidgetThenWholeDocument(): Promise<void> {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowRight');
		await expect(overlay()).toBeVisible();
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('ControlOrMeta+a');
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	}

	test('the widget overlay goes away when select-all opens the range', async () => {
		await selectWidgetThenWholeDocument();
		await expect(overlay()).toHaveCount(0);
	});

	test('Mod+C copies the document, not the widget slice', async () => {
		await selectWidgetThenWholeDocument();

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		expect(await editor.readClipboard()).toContain('lead');
	});

	test('Backspace deletes the document, not just the widget', async () => {
		await selectWidgetThenWholeDocument();

		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('lead');

		expect((await editor.bridge.getSource()).trim()).toBe('');
	});
});
