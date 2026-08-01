import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Selecting a widget clears the native selection, so what decides whether the chord's event
// reaches the block is whether the paragraph holds a text position for a caret to survive in.
// Beside prose one does; in a widget-only paragraph none does, and the browser dispatches at
// <body> for BOTH selection routes (requirements/blocks/image/clipboard.md).

const IMG_MD = '![cat](/test-fixtures/sample.png)';
const WIDGET_ONLY = `lead\n\n${IMG_MD}\n\ntail\n`;
const BESIDE_PROSE = `lead${IMG_MD}\n`;

test.describe('selected image-widget copy/cut', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const overlay = () => editor.page.locator('[data-image-overlay]');
	const readClipboard = () => editor.page.evaluate(() => navigator.clipboard.readText());

	async function open(doc: string): Promise<void> {
		await editor.loadContent(doc);
		// The clipboard outlives the browser context, so a chord that writes NOTHING would
		// otherwise read back the previous case's payload and pass.
		await editor.page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
	}

	// Stepping OUT of the paragraph above, so the landing runs the cross-block edge entry. A
	// caret seated programmatically inside a widget-only block never enters the widget at all.
	async function selectByArrowFromAbove(): Promise<void> {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowRight');
		await expect(overlay()).toBeVisible();
	}

	async function selectByClick(): Promise<void> {
		await editor.page.locator('[data-image-widget]').click();
		await expect(overlay()).toBeVisible();
	}

	const ROUTES = [
		['arrow', selectByArrowFromAbove],
		['click', selectByClick]
	] as const;

	for (const [route, selectWidget] of ROUTES) {
		test(`widget-only paragraph, ${route}-selected: Mod+C copies the markdown and mutates nothing`, async () => {
			await open(WIDGET_ONLY);
			await selectWidget();
			const before = await editor.bridge.getSource();

			await editor.page.keyboard.press('Control+c');
			await editor.waitForClipboardWrite();

			expect(await readClipboard()).toBe(IMG_MD);
			expect(await editor.bridge.getSource()).toBe(before);
			await expect(overlay()).toBeVisible();
		});

		test(`widget-only paragraph, ${route}-selected: Mod+X cuts as one commit that undo restores`, async () => {
			await open(WIDGET_ONLY);
			const before = await editor.bridge.getSource();
			await selectWidget();

			await editor.page.keyboard.press('Control+x');
			await editor.waitForClipboardWrite();

			expect(await readClipboard()).toBe(IMG_MD);
			await editor.bridge.waitForSourceNotContains('sample.png');
			await expect(overlay()).toHaveCount(0);
			await editor.undo();
			await editor.bridge.waitForSourceEquals(before);
		});
	}

	// The third arm of the same body route: paste over a selected widget replaces its slice.
	test('widget-only paragraph, click-selected: Mod+V replaces the widget with the pasted text', async () => {
		await open(WIDGET_ONLY);
		await editor.page.evaluate(() => navigator.clipboard.writeText('REPLACED'));
		await selectByClick();

		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('REPLACED');

		expect((await editor.bridge.getSource()).trim()).toBe('lead\n\nREPLACED\n\ntail');
	});

	// The contrast that says the body route is what was missing, not the widget arm: with prose
	// beside the image a caret survives the selection, so the event reaches the block directly.
	test('image beside prose keeps reaching the block’s own handlers', async () => {
		await open(BESIDE_PROSE);
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowLeft');
		await expect(overlay()).toBeVisible();

		await editor.page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();

		expect(await readClipboard()).toBe(IMG_MD);
		expect((await editor.bridge.getSource()).trim()).toBe('lead');
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});
});
