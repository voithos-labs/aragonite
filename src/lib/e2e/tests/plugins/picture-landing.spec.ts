import { test } from '../../fixtures';
import { PluginsPage } from './helpers';

// A range taken whole beside a table of contents or a `$$` block, a key, then a letter: the landing
// never rests on the picture's source (`requirements/plugins/picture-landing.md`).

interface Row {
	name: string;
	doc: string;
	/** A divider through a heading's end, both taken whole. */
	from: number[];
	to: number[];
	elsewhere: number[];
	key: 'Backspace' | 'Delete' | 'ControlOrMeta+x';
	after: string;
}

const AFTER_TOC = 'first\n\n***\n\nbody\n\n# hd\n\n[[toc]]\n\nlast\n';
const AFTER_MATH = 'first\n\n***\n\nbody\n\n# hd\n\n$$\nm\n$$\n';

const ROWS: Row[] = [
	{
		name: 'Delete before a table of contents holds the gap above it',
		doc: AFTER_TOC,
		from: [1],
		to: [3],
		elsewhere: [0],
		key: 'Delete',
		after: 'first\n\nx\n\n[[toc]]\n\nlast\n'
	},
	{
		name: 'a cut before a table of contents holds the gap above it',
		doc: AFTER_TOC,
		from: [1],
		to: [3],
		elsewhere: [0],
		key: 'ControlOrMeta+x',
		after: 'first\n\nx\n\n[[toc]]\n\nlast\n'
	},
	{
		name: 'Backspace with nothing above, before a table of contents, holds the gap above it',
		doc: '***\n\nbody\n\n# hd\n\n[[toc]]\n\nlast\n',
		from: [0],
		to: [2],
		elsewhere: [4],
		key: 'Backspace',
		after: 'x\n\n[[toc]]\n\nlast\n'
	},
	{
		name: 'Backspace after a table of contents goes to the text its gap gives way to',
		doc: '[[toc]]\n\n***\n\nbody\n\n# hd\n\nnext\n',
		from: [1],
		to: [3],
		elsewhere: [4],
		key: 'Backspace',
		after: '[[toc]]\n\nxnext\n'
	},
	{
		name: 'Delete before a `$$` block lands in its body',
		doc: AFTER_MATH,
		from: [1],
		to: [3],
		elsewhere: [0],
		key: 'Delete',
		after: 'first\n\n$$\nxm\n$$\n'
	},
	{
		name: 'a cut before a `$$` block holds the gap above it',
		doc: AFTER_MATH,
		from: [1],
		to: [3],
		elsewhere: [0],
		key: 'ControlOrMeta+x',
		after: 'first\n\nx\n\n$$\nm\n$$\n'
	},
	{
		name: 'Backspace after a `$$` block lands at its body’s end',
		doc: '$$\nm\n$$\n\n***\n\nbody\n\n# hd\n\nnext\n',
		from: [1],
		to: [3],
		elsewhere: [4],
		key: 'Backspace',
		after: '$$\nmx\n$$\n\nnext\n'
	},
	{
		name: 'Backspace after a one-line `$$` block lands at its formula’s end',
		doc: '$$m$$\n\n***\n\nbody\n\n# hd\n\nnext\n',
		from: [1],
		to: [3],
		elsewhere: [4],
		key: 'Backspace',
		after: '$$mx$$\n\nnext\n'
	}
];

for (const mode of ['live', 'source'] as const)
	test.describe(`a range beside a picture of its source, ${mode}`, () => {
		for (const row of ROWS)
			test(row.name, async ({ page }) => {
				const editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.setPresentationMode(mode);
				await editor.loadContent(row.doc);
				await editor.focusBlockAtPath(row.elsewhere, 0);
				await editor.bridge.setSelection({
					anchor: { path: row.from, offset: 0 },
					focus: { path: row.to, offset: 4 }
				});
				await page.keyboard.press(row.key);
				await page.keyboard.type('x');
				// A `$$` body commits its source when the caret leaves it.
				await page.mouse.click(5, 5);
				await editor.bridge.waitForSourceEquals(row.after);
			});
	});
