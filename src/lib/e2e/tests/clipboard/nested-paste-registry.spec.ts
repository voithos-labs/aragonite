import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('nested structural paste: ref alignment via registry', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The exact source catches a structural paste spliced into the wrong child list of a nested
	// container, where the substrings would still all be present.
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

		// The two emptied paragraphs leave one empty line, so one blank quote line parts the paste
		// from the tail, as a cut and then this paste would leave it.
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['> alpha', '>', '> beta', '>', '> gammaX', '> ', '> tail para'].join('\n')
		);
	});
});
