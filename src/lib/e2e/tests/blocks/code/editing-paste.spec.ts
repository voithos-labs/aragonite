import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('code block paste — fence bumping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste containing ``` into a code block bumps outer fence to ````', async () => {
		await editor.loadContent('```\nfirst\n```\n');
		await editor.getBlock(0).click();
		// End of the body line, not of the block: the block's last offset sits inside the closer,
		// where writes are refused.
		await editor.focusBlock(0, 9);

		// The run has to be a LINE to threaten the fence, so an inline `` ```pasted code``` `` is
		// ordinary body text.
		await editor.seedClipboard('\n```\npasted code\n');
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('pasted code');

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^````/m);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});

	test('paste of multi-block markdown stays literal inside a code block', async () => {
		await editor.loadContent('```\ncontent\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlock(0, 11);

		await editor.seedClipboard('\n# Heading\n\n- list item\n\nparagraph\n');
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('# Heading');

		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		const source = await editor.bridge.getSource();
		expect(source).toContain('- list item');
		expect(source).toContain('paragraph');
	});
});
