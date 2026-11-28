import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';

// Requirements: `e2e/requirements/selection/heading-over-range.md`.

interface Row {
	name: string;
	source: string;
	/** Where a click puts the range's start, and where a Shift+click carries it. */
	from: [number[], number];
	to: [number[], number];
	after: string;
	/** The route whose plugins read the block as its kind; the built-in harness otherwise. */
	plugins?: true;
}

const ROWS: Row[] = [
	{
		name: 'a heading and a paragraph from mid-block to mid-block',
		source: 'first\n\n## head\n\nbody\n\nlast\n',
		from: [[0], 2],
		to: [[2], 2],
		after: '## first\n\n## head\n\n## body\n\nlast\n'
	},
	{
		name: 'a divider and a code block between paragraphs',
		source: 'first\n\n***\n\n```\ncode\n```\n\nlast\n',
		from: [[0], 2],
		to: [[3], 2],
		after: '## first\n\n***\n\n```\ncode\n```\n\n## last\n'
	},
	{
		name: 'two list items',
		source: '- one\n- two\n',
		from: [[0, 0, 0], 1],
		to: [[0, 1, 0], 2],
		after: '- ## one\n- ## two\n'
	},
	{
		name: 'a callout’s body, from its first line',
		source: '::::note\nalpha\n\nbeta\n::::\n',
		from: [[0, 1], 0],
		to: [[0, 2], 2],
		after: '::::note\n## alpha\n\n## beta\n::::\n',
		plugins: true
	}
];

test.describe('a heading key over a range re-kinds every text block it reaches', () => {
	for (const row of ROWS)
		for (const mode of ['source', 'live'] as const) {
			test(`Mod+2 over ${row.name} (${mode})`, async ({ page }) => {
				const editor = row.plugins ? new PluginsPage(page) : new EditorPage(page);
				if (editor instanceof PluginsPage) await editor.gotoPlugins();
				else await editor.goto();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.source);
				await editor.focusBlockAtPath(...row.from);
				await editor.shiftClickBlock(...row.to);
				await editor.waitForCrossBlock(true);

				await editor.page.keyboard.press('ControlOrMeta+2');

				await expect.poll(() => editor.bridge.getSource()).toBe(row.after);
				expect(await editor.bridge.ownsRange()).toBe(true);
				expect(await editor.parseConverged()).toBe(true);

				await editor.undo();
				await expect.poll(() => editor.bridge.getSource()).toBe(row.source);
			});
		}
});
