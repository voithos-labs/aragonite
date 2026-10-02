import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Typing the closing quote of a title under a link definition hands the paragraph to the
// definition, as a reload would (`requirements/text-editing/close-link-title.md`).

// Polled rather than waited on, so a red prints the bytes the editor wrote.
const expectSource = (ep: EditorPage, expected: string) =>
	expect.poll(() => ep.bridge.getSource(), { timeout: 5000 }).toBe(expected);

test.describe('typing a link title’s closing quote', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const [label, doc, closed] of [
		['a one-line title', '[a]: /u\n"x\n', '[a]: /u\n"x"\n'],
		['a two-line title', '[a]: /u\n"x\nmore\n', '[a]: /u\n"x\nmore"\n']
	] as const) {
		test(`the definition takes ${label} in`, async ({ page }) => {
			await editor.loadContent(doc);
			await editor.clickBlockAtPath([1], 1);
			await page.keyboard.press('ControlOrMeta+End');
			await page.keyboard.type('"');

			await expectSource(editor, closed);
			expect(await editor.bridge.getBlockCount()).toBe(1);
			expect(await editor.parseConverged()).toBe(true);

			// The caret moved into the definition with its text, so the next key lands after the quote.
			await page.keyboard.type('Z');
			await expectSource(editor, closed.replace(/"\n$/, '"Z\n'));
			expect(await editor.parseConverged()).toBe(true);
		});
	}
});
