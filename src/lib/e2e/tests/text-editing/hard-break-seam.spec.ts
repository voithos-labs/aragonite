import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';

// Shift+Enter cuts where Enter would: a soft line break right after the caret becomes the hard
// one, and a closer that ends at the caret stays on its line
// (`requirements/text-editing/hard-break-seam.md`).

interface Row {
	name: string;
	source: string;
	modes: ('source' | 'live')[];
	/** Where the caret goes: End, or that many ArrowLefts from it. */
	back: number;
	broken: string;
}

const BR = '\\\n';
const ROWS: Row[] = [
	{
		name: 'at a line end before a soft break',
		source: 'one\ntwo\n',
		modes: ['source', 'live'],
		back: 0,
		broken: `one${BR}xtwo\n`
	},
	{
		name: 'at an emphasis’s close',
		source: '*oneo*\ntwo\n',
		modes: ['live'],
		back: 0,
		broken: `*oneo*${BR}xtwo\n`
	},
	{
		name: 'at a link’s close',
		source: '[oneo](u)\ntwo\n',
		modes: ['live'],
		back: 0,
		broken: `[oneo](u)${BR}xtwo\n`
	},
	{
		name: 'inside an emphasis',
		source: '*oneo*\ntwo\n',
		modes: ['live'],
		back: 2,
		broken: `*on${BR}xeo*\ntwo\n`
	}
];

for (const row of ROWS)
	for (const mode of row.modes)
		test(`Shift+Enter ${row.name} cuts where Enter would, ${mode}`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.setPresentationMode(mode);
			await editor.loadContent(row.source);
			const inText = await pointAtRaw(page, [0], 2);
			await page.mouse.click(inText.x, inText.y);
			await page.keyboard.press('End');
			for (let i = 0; i < row.back; i++) await page.keyboard.press('ArrowLeft');
			await page.keyboard.press('Shift+Enter');
			await page.keyboard.type('x');
			await editor.bridge.waitForSourceEquals(row.broken);
		});
