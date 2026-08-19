import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { DEFAULT_CONTENT } from '../../../test-content';

test.describe('clipboard — cut three blocks then undo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DEFAULT_CONTENT);
	});

	test('cut headings then undo restores all three', async () => {
		const before = await editor.bridge.getSource();

		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([2], 13);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSource((s) => !s.includes('# Heading 1'));

		const afterCut = await editor.bridge.getSource();
		expect(afterCut).not.toContain('# Heading 1');
		expect(afterCut).not.toContain('## Heading 2');
		expect(afterCut).not.toContain('### Heading 3');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
