import { test, expect } from '../../../fixtures';
import { EditorPage, BLOCK_CONTENT_SELECTOR } from '../../../editor-page';
import { DEFAULT_CONTENT } from '../../../test-content';

test.describe('clipboard — code block boundary and direction', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DEFAULT_CONTENT);
	});

	test('Ctrl+Shift+End from inside a code block extends to the final paragraph', async () => {
		await editor.focusBlockAtPath([9], 0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardContains('A final paragraph');

		const clip = await editor.readClipboard();
		expect(clip).toContain('const x = 42');
		expect(clip).toContain('A final paragraph');
	});

	test('Shift+ArrowDown from end of a code block enters cross-block mode anchored in code', async () => {
		const codeRaw = await editor.page.evaluate((contentSelector) => {
			const wrapper = document.querySelector(`[data-block-path='${JSON.stringify([9])}']`);
			const editable = wrapper?.querySelector(contentSelector) as HTMLElement | null;
			return editable?.textContent ?? '';
		}, BLOCK_CONTENT_SELECTOR);
		await editor.focusBlockAtPath([9], codeRaw.length);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const paths = await editor.page.evaluate(
			() => (window as any).__test?.getSelectionPaths?.() ?? null
		);
		expect(paths?.anchor.path).toEqual([9]);
		expect(paths?.focus.path).toEqual([10]);
	});

	test('bottom-to-top selection copies the block above', async () => {
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardContains('Heading 1');

		const clip = await editor.readClipboard();
		expect(clip).toContain('Heading 1');
		expect(clip).not.toContain('Heading 2');
	});
});
