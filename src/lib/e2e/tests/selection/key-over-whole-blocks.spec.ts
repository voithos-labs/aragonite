import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Requirements: `e2e/requirements/selection/key-over-whole-blocks.md`.

interface Row {
	name: string;
	source: string;
	key: string;
	/** The bytes after the key and then `x`. */
	lettered: string;
}

const ROWS: Row[] = [
	{
		name: 'a typed `>` before a paragraph',
		source: 'first\n\n***\n\n# head\n\nlast\n',
		key: '>',
		lettered: 'first\n\n> x\n\nlast\n'
	},
	{
		name: 'a typed space before a code block',
		source: 'first\n\n***\n\n# head\n\n```\ncode\n```\n',
		key: ' ',
		lettered: 'first\n\n x\n\n```\ncode\n```\n'
	}
];

test.describe('a key typed over whole blocks leaves the block below alone', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const row of ROWS)
		for (const mode of ['source', 'live'] as const) {
			test(`${row.name} (${mode})`, async () => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.source);
				await editor.holdBlockWhole('.thematic-break-block');
				await editor.shiftClickBlock([2], 6);

				await editor.typeSlowly(row.key);
				await editor.typeSlowly('x');

				await expect.poll(() => editor.bridge.getSource()).toBe(row.lettered);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
});
