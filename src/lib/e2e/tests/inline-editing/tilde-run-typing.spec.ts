import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A tilde pairs only as a double run, so two single tildes are the user's bytes and a key typed
// between them keeps both, in every mode that shows them.

const MODES = ['source', 'live'] as const;

test.describe('inline editing, typing between two tildes', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		test(`a space typed inside \`~~\` keeps both tildes (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('a~~b\n');
			await editor.focusBlock(0, 2);
			await page.keyboard.type(' ');

			await expect.poll(() => editor.bridge.getSource()).toBe('a~ ~b\n');
		});

		test(`Backspace inside \`~~\` takes one tilde (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('a~~b\n');
			await editor.focusBlock(0, 2);
			await page.keyboard.press('Backspace');

			await expect.poll(() => editor.bridge.getSource()).toBe('a~b\n');
		});
	}
});
