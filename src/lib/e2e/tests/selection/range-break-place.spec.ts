import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';

// Requirements: `e2e/requirements/selection/range-break-place.md`.

interface Row {
	name: string;
	source: string;
	/** Where a Shift+click carries the range on from the divider held whole. */
	to?: [number[], number];
	key: 'Enter' | 'Shift+Enter';
	/** The bytes after the key and then `x`. */
	lettered: string;
	/** The route whose plugins read the block as its kind; the built-in harness otherwise. */
	plugins?: true;
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
	},
	{
		name: 'a divider held whole flush between two lines',
		source: 'first\n***\nlast\n',
		key: 'Enter',
		lettered: 'first\n\nx\n\nlast\n'
	},
	{
		name: 'a divider held whole flush between two lines',
		source: 'first\n***\nlast\n',
		key: 'Shift+Enter',
		lettered: 'first\n\n\\\nx\n\nlast\n'
	},
	{
		name: "a divider held whole, a list item's only block",
		source: '- a\n- ***\n- last\n',
		key: 'Enter',
		lettered: '- a\n- x\n- last\n'
	},
	{
		name: "a divider held whole, a quote's last block",
		source: '> a\n>\n> ***\n\nafter\n',
		key: 'Enter',
		lettered: '> a\n>\n> x\n\nafter\n'
	},
	{
		name: "a divider held whole, a callout's last block",
		source: ':::note\nfirst\n\n***\n:::\n',
		key: 'Enter',
		lettered: ':::note\nfirst\n\nx\n:::\n',
		plugins: true
	}
];

test.describe('a line break over a range writes in no block the range did not reach', () => {
	for (const row of ROWS)
		for (const mode of ['source', 'live'] as const) {
			test(`${row.key} over ${row.name} (${mode})`, async ({ page }) => {
				const editor = row.plugins ? new PluginsPage(page) : new EditorPage(page);
				if (editor instanceof PluginsPage) await editor.gotoPlugins();
				else await editor.goto();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.source);
				await editor.holdBlockWhole('.thematic-break-block');
				if (row.to) await editor.shiftClickBlock(...row.to);

				await editor.page.keyboard.press(row.key);
				await editor.typeSlowly('x');

				await expect.poll(() => editor.bridge.getSource()).toBe(row.lettered);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
});
