import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// A space typed at an item's content start widens its marker, and the item's lines are read again
// under the wider marker; the caret stays before the text it was in front of.
// Requirements: `e2e/requirements/blocks/list/marker-space-caret.md`.

const ROWS = [
	{
		name: 'a top-level item whose next paragraph leaves it',
		source: '- ab\n\n  b\n',
		leaf: [0, 0, 0],
		typed: '-  Xab\n\n  b\n'
	},
	{
		name: 'an item in a quote whose next paragraph leaves it',
		source: '> - ab\n>\n>   b\n',
		leaf: [0, 0, 0, 0],
		typed: '> -  Xab\n>\n>   b\n'
	}
];

for (const mode of ['source', 'live'] as const) {
	test.describe(`a space at an item's content start, in ${mode} mode`, () => {
		let editor: EditorPage;

		test.beforeEach(async ({ page }) => {
			editor = new EditorPage(page);
			await editor.goto();
			await editor.setPresentationMode(mode);
		});

		for (const row of ROWS) {
			test(`keeps the caret before the text in ${row.name}`, async ({ page }) => {
				await editor.loadContent(row.source);
				await editor.focusBlockAtPath(row.leaf, 0);

				await page.keyboard.press('Space');
				await page.keyboard.type('X');

				await expect.poll(() => editor.bridge.getSource()).toBe(row.typed);
			});
		}
	});
}
