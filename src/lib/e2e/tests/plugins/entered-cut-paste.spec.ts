import { test } from '../../fixtures';
import { PluginsPage } from './helpers';

// A cut from a divider into a block whose opening stays, then a paste: the cut holds the gap above
// that opening, and the paste of its own entry there gives the document back
// (`requirements/plugins/entered-cut-paste.md`).

interface Row {
	name: string;
	doc: string;
	focus: { path: number[]; offset: number; cellCoordinate?: true };
}

const TITLED = 'first\n\n***\n\nbody\n\n:::tip Title\nin\n:::\n';
const TABLE = 'first\n\n***\n\nbody\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n';

const ROWS: Row[] = [
	{
		name: 'a cut into a titled tip’s title pastes back',
		doc: TITLED,
		focus: { path: [3, 0], offset: 9 }
	},
	{
		name: 'a cut into a table’s rows pastes back',
		doc: TABLE,
		focus: { path: [3], offset: 2, cellCoordinate: true }
	}
];

for (const mode of ['live', 'source'] as const)
	test.describe(`a cut into a block whose opening stays, then a paste, ${mode}`, () => {
		for (const row of ROWS) {
			test(row.name, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.doc);
				await editor.focusBlockAtPath([0], 0);
				await editor.bridge.setSelection({ anchor: { path: [1], offset: 0 }, focus: row.focus });
				await page.keyboard.press('ControlOrMeta+x');
				await editor.paste();
				await editor.bridge.waitForSourceEquals(row.doc);
			});
			test(`${row.name}: the cut holds the gap, so a letter opens a paragraph above`, async ({
				page
			}) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.doc);
				await editor.focusBlockAtPath([0], 0);
				await editor.bridge.setSelection({ anchor: { path: [1], offset: 0 }, focus: row.focus });
				await page.keyboard.press('ControlOrMeta+x');
				await page.keyboard.type('x');
				await editor.bridge.waitForSourceEquals(
					row.doc === TITLED
						? 'first\n\nx\n\n:::tip tle\nin\n:::\n'
						: 'first\n\nx\n\n| a | b |\n|---|---|\n| 3 | 4 |\n'
				);
			});
		}
	});
