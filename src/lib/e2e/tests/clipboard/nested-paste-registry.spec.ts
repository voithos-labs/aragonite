import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('nested structural paste — ref alignment via registry', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Asserting the exact source catches a structural paste going to the wrong place inside a
	// nested container: the substrings survive while the blockquote's children are spliced
	// into the wrong child list.
	test('paste multi-block markdown inside a blockquote focuses the last inserted block', async () => {
		await editor.loadContent('> first para\n>\n> second para\n>\n> tail para\n');

		await editor.seedClipboard('alpha\n\nbeta\n\ngamma\n');

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([0, 1], 'second para'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste();
		await editor.bridge.waitForSourceContains('gamma');

		// Caret should land at the end of "gamma" (the last pasted block).
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('gammaX');

		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['> alpha', '>', '> beta', '>', '> gammaX', '>', '> tail para'].join('\n')
		);
	});
});
