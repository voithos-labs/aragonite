// @vitest-environment jsdom
// A range removal ending inside a later list item takes the item's marker line with the block it
// joins, and every line under it keeps its bytes, as Backspace at the item's start does (M1).
// Miss-analysis: the range rows ended in flat items or in an item's only block, so no row left an
// item holding a block under the one the range took, and the marker moved onto that block.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { insertBy } from '#lib/test/harness/insertion-routes.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

const NESTED = '- i0\n  - i1\n    - i2\n  - i3\n    - i4\n\n    p5\n';
const I2 = [0, 0, 1, 0, 1, 0, 0];
const I3 = [0, 0, 1, 1, 0];
const I4 = [0, 0, 1, 1, 1, 0, 0];

// Each range with the bytes it leaves, `|` marking where the two lines join.
const REMOVALS: [
	name: string,
	source: string,
	from: SelectionPoint,
	to: SelectionPoint,
	left: string
][] = [
	[
		'from the middle of i2 to the middle of i3, which holds a sublist and a paragraph',
		NESTED,
		at(I2, 1),
		at(I3, 1),
		'- i0\n  - i1\n    - i|3\n    - i4\n\n    p5\n'
	],
	[
		'from the end of i2 to the start of i3',
		NESTED,
		at(I2, 2),
		at(I3, 0),
		'- i0\n  - i1\n    - i2|i3\n    - i4\n\n    p5\n'
	],
	[
		'from i2 into i4, a level below i3',
		NESTED,
		at(I2, 1),
		at(I4, 1),
		'- i0\n  - i1\n    - i|4\n\n    p5\n'
	],
	[
		'into the first item of a nested list',
		'- i0\n  - i1\n    - i2\n',
		at([0, 0, 0], 1),
		at([0, 0, 1, 0, 0], 1),
		'- i|1\n    - i2\n'
	],
	[
		'from a paragraph into a first item holding a sublist',
		'p0\n\n- i1\n  - i2\n',
		at([0], 1),
		at([1, 0, 0], 1),
		'p|1\n\n  - i2\n'
	],
	[
		'from a paragraph into a first item holding a paragraph',
		'p0\n\n- i1\n\n  p2\n',
		at([0], 1),
		at([1, 0, 0], 1),
		'p|1\n\n  p2\n'
	],
	[
		'between flat items, the second holding a sublist',
		'- i0\n- i1\n  - i2\n',
		at([0, 0, 0], 1),
		at([0, 1, 0], 1),
		'- i|1\n  - i2\n'
	],
	[
		'in an ordered list, which renumbers',
		'1. i0\n2. i1\n   1. i2\n3. i3\n',
		at([0, 0, 0], 1),
		at([0, 1, 0], 1),
		'1. i|1\n   1. i2\n2. i3\n'
	],
	[
		'in a list inside a quote',
		'> - i0\n> - i1\n>   - i2\n',
		at([0, 0, 0, 0], 1),
		at([0, 0, 1, 0], 1),
		'> - i|1\n>   - i2\n'
	],
	[
		'between to-do items',
		'- [ ] i0\n- [ ] i1\n  - i2\n',
		at([0, 0, 0], 1),
		at([0, 1, 0], 1),
		'- [ ] i|1\n  - i2\n'
	],
	[
		'between items with nothing under them',
		'- i0\n- i1\n- i2\n',
		at([0, 0, 0], 1),
		at([0, 1, 0], 1),
		'- i|1\n- i2\n'
	]
];

async function mountOver(source: string, from: SelectionPoint, to: SelectionPoint) {
	const editor = mountEditor({ source });
	await editor.instance.setSelection({ anchor: from, focus: to });
	await editor.settle();
	return editor;
}

const GESTURES: [
	name: string,
	run: (editor: MountedEditor, to: SelectionPoint) => Promise<unknown>,
	typed: string
][] = [
	['Backspace', (editor, to) => pressKey(surfaceAt(editor, to.path), { key: 'Backspace' }), ''],
	['Delete', (editor, to) => pressKey(surfaceAt(editor, to.path), { key: 'Delete' }), ''],
	['a typed letter', (editor, to) => insertBy('soft key', surfaceAt(editor, to.path), 'Z'), 'Z']
];

describe('a range removal ending inside a later list item', () => {
	for (const [name, source, from, to, left] of REMOVALS) {
		for (const [gesture, run, typed] of GESTURES) {
			it(`${gesture} ${name}`, async () => {
				const editor = await mountOver(source, from, to);
				await run(editor, to);
				expect(editor.source()).toBe(left.replace('|', typed));
			});
		}
	}

	it('is one undo entry, and redo writes the same bytes again', async () => {
		const editor = await mountOver(NESTED, at(I2, 1), at(I3, 1));
		await pressKey(surfaceAt(editor, I3), { key: 'Backspace' });
		const removed = editor.source();
		await pressKey(surfaceAt(editor, I2), { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe(NESTED);
		await pressKey(surfaceAt(editor, I2), { key: 'y', ctrlKey: true });
		expect(editor.source()).toBe(removed);
	});
});
