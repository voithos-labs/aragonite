import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Requirements: `e2e/requirements/selection/range-break-place.md`.

/** A drag across the one divider holds it whole; a Shift+click at `to` then carries the range on. */
async function fromDivider(editor: EditorPage, to?: [number[], number]): Promise<void> {
	const rule = await editor.page.locator('.thematic-break-block').boundingBox();
	if (!rule) throw new Error('no box for the divider');
	const y = rule.y + rule.height / 2;
	await editor.page.mouse.move(rule.x + 8, y);
	await editor.page.mouse.down();
	await editor.page.mouse.move(rule.x + rule.width - 8, y, { steps: 8 });
	await editor.page.mouse.up();
	await editor.waitForCrossBlock(true);
	if (to) await editor.shiftClickBlock(...to);
}

interface Row {
	name: string;
	source: string;
	to?: [number[], number];
	key: 'Enter' | 'Shift+Enter';
	/** The bytes after the key and then `x`. */
	lettered: string;
}

const ROWS: Row[] = [
	{
		name: 'whole blocks with a paragraph before',
		source: 'first\n\n***\n\n# head\n\nlast\n',
		to: [[2], 6],
		key: 'Shift+Enter',
		lettered: 'first\n\n\\\nx\n\nlast\n'
	},
	{
		name: 'whole blocks under a fence',
		source: '```\ncode\n```\n\n***\n\n# head\n\nlast\n',
		to: [[2], 6],
		key: 'Enter',
		lettered: '```\ncode\n```\n\nx\n\nlast\n'
	},
	{
		name: 'whole blocks under a fence',
		source: '```\ncode\n```\n\n***\n\n# head\n\nlast\n',
		to: [[2], 6],
		key: 'Shift+Enter',
		lettered: '```\ncode\n```\n\n\\\nx\n\nlast\n'
	},
	{
		name: "a quote's last blocks, tight",
		source: '> above\n> ***\n>\n> para\n\nafter\n',
		to: [[0, 2], 4],
		key: 'Shift+Enter',
		lettered: '> above\n>\n> \\\n> x\n\nafter\n'
	},
	{
		name: 'a divider held whole',
		source: 'first\n\n***\n\nlast\n',
		key: 'Shift+Enter',
		lettered: 'first\n\n\\\nx\n\nlast\n'
	}
];

test.describe('a line break over a range writes in no block the range did not reach', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const row of ROWS)
		for (const mode of ['source', 'live'] as const) {
			test(`${row.key} over ${row.name} (${mode})`, async () => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.source);
				await fromDivider(editor, row.to);

				await editor.page.keyboard.press(row.key);
				await editor.typeSlowly('x');

				await expect.poll(() => editor.bridge.getSource()).toBe(row.lettered);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
});
