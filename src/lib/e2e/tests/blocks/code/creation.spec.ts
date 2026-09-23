import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('code block creation: Enter after typing ```', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter after a typed ``` completes the fence with the caret on its body line', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.bridge.waitForSourceContains('```');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');

		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```\n\n```\n');
		await editor.typeText('body');
		// Enter must not be swallowed, or "body" lands on the opener line as "```body".
		await editor.bridge.waitForSourceEquals('```\nbody\n```\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});
});
