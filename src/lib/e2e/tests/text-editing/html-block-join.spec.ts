import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Retyping a `<div>` line under a paragraph as `<span>` joins the two into one paragraph, as a
// reload would (`requirements/text-editing/html-block-join.md`).

// Polled rather than waited on, so a red prints the bytes the editor wrote.
const expectSource = (ep: EditorPage, expected: string) =>
	expect.poll(() => ep.bridge.getSource(), { timeout: 5000 }).toBe(expected);

for (const mode of ['source', 'live'] as const) {
	test(`${mode} mode: an HTML block retyped so it can't interrupt joins the paragraph above`, async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
		await editor.loadContent('foo\n<div>\n');
		await editor.clickBlockAtPath([1], 1);
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowLeft');
		// Typed over a selection, so every key leaves an HTML block: `<s>` already can't interrupt.
		for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.type('span');

		await expectSource(editor, 'foo\n<span>\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.getDomBlockCount()).toBe(1);
		expect(await editor.parseConverged()).toBe(true);
	});
}
