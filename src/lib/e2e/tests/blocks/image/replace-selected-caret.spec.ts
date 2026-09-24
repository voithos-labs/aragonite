import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/image/replace-selected-caret.md`.

const IMAGE = '![c|60x40](/test-fixtures/sample.png)';
const SOURCE = `abc ${IMAGE} tail\n`;
const caretAt = (offset: number) => ({
	anchor: { path: [0], offset },
	focus: { path: [0], offset }
});

test.describe('text replacing a selected image leaves a caret after it', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SOURCE);
		await page.locator('[data-image-widget]').first().click();
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
	});

	test('insertMarkdown puts the caret after the inserted text', async ({ page }) => {
		const inserted = await page.evaluate(
			(md) => (window as any).__test.insertMarkdown(md) as Promise<boolean>,
			'text'
		);

		expect(inserted).toBe(true);
		expect(await editor.bridge.getSource()).toBe('abc text tail\n');
		// Read at once: the insert resolves only after the caret has landed.
		expect(await editor.bridge.getSelection()).toEqual(caretAt('abc text'.length));
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('abc textZ tail\n');
	});

	test('a paste puts the caret after the pasted text', async ({ page }) => {
		await editor.seedClipboard('text');
		await editor.paste();

		await editor.bridge.waitForSourceEquals('abc text tail\n');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('abc textZ tail\n');
	});
});
