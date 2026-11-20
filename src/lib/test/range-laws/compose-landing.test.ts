// @vitest-environment jsdom
// A composition over a range, mounted in both modes, lands where a key typed over the range does
// where the range ended at a leaf's end or between blocks, and where Delete then a key do where it
// ended inside a leaf's text, before the rest of that text. Either way it joins only text of the
// leaf the range ended in.
// Miss-analysis: the composition rows ran a range into a container's body alone, so none ended at a
// table row's end, where a composition paired with Delete joined the next row's first cell.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { mountCase, placeRange, typeGesture, type Editor } from './gestures';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['source', 'live'];
const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n# h\n';
const KEPT_ROW = '| a | b |\n|---|---|\n| 3 | 4 |\n\n# h\n';

interface Row {
	name: string;
	source: string;
	select: EditorSelection;
	/** The gesture the composition lands as: a key typed over the range, or Delete then a key. */
	as: 'a typed key' | 'Delete';
	/** The document once `x` is in. */
	typed: string;
}

const toRow = (anchor: EditorSelection['anchor'], table: number[]): EditorSelection => ({
	anchor,
	focus: { path: table, offset: 2, cellCoordinate: true }
});

const ROWS: Row[] = [
	{
		name: 'from a rule in a details to a table row’s end',
		source: `<details open>\n<summary>Sum</summary>\n\n***\n\nbody\n\n</details>\n\n${TABLE}`,
		select: toRow({ path: [0, 1], offset: 0 }, [1]),
		as: 'a typed key',
		typed: `<details open>\n<summary>Sum</summary>\n\nx\n</details>\n\n${KEPT_ROW}`
	},
	{
		name: 'from a table in a note to a table row’s end',
		source: `:::note\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nbody\n:::\n\n${TABLE}`,
		select: toRow({ path: [0, 1], offset: 0, cellCoordinate: true }, [1]),
		as: 'a typed key',
		typed: `:::note\n\nx\n:::\n\n${KEPT_ROW}`
	},
	{
		name: 'from the document’s first block to a table row’s end',
		source: `***\n\nbody\n\n${TABLE}`,
		select: toRow({ path: [0], offset: 0 }, [2]),
		as: 'a typed key',
		typed: `x\n\n${KEPT_ROW}`
	},
	{
		name: 'from a rule in a note to a paragraph’s end before a heading',
		source: ':::note\n***\n\nbody\n:::\n\npara\n\n# h\n',
		select: { anchor: { path: [0, 1], offset: 0 }, focus: { path: [1], offset: 4 } },
		as: 'a typed key',
		typed: ':::note\n\nx\n:::\n\n# h\n'
	},
	{
		name: 'from a rule in a note to an item’s end before the next item',
		source: ':::note\n***\n\nbody\n:::\n\n- one\n- two\n',
		select: { anchor: { path: [0, 1], offset: 0 }, focus: { path: [1, 0, 0], offset: 3 } },
		as: 'a typed key',
		typed: ':::note\n\nx\n:::\n- two\n'
	},
	{
		name: 'out of a quote from a block taken whole, a heading after',
		source: 'intro\n\n> above\n> # text\n> below\n\n# h\n',
		select: { anchor: { path: [1, 1], offset: 0 }, focus: { path: [1, 2], offset: 5 } },
		as: 'a typed key',
		typed: 'intro\n\n> above\n>\n> x\n\n# h\n'
	},
	{
		name: 'from a rule in a note into a paragraph’s text',
		source: ':::note\n***\n\nbody\n:::\n\npara\n\n# h\n',
		select: { anchor: { path: [0, 1], offset: 0 }, focus: { path: [1], offset: 2 } },
		as: 'Delete',
		typed: ':::note\nxra\n:::\n\n# h\n'
	}
];

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

async function placed(row: Row, mode: PresentationMode): Promise<Editor> {
	const editor = mountCase(row.source, mode);
	await editor.settle();
	await placeRange(editor, row.select);
	return editor;
}

describe('a composition over a range lands as the typed key or Delete does', () => {
	for (const mode of MODES)
		for (const row of ROWS) {
			it(`${mode}: ${row.name}, as ${row.as}`, async () => {
				const editor = await placed(row, mode);
				if (row.as === 'Delete') {
					await pressHardwareKey(focused(), { key: 'Delete' });
					await editor.settle();
					await pressHardwareKey(focused(), { key: 'x' });
				} else await typeGesture(editor, { text: 'x', route: 'hardware key' });
				await editor.settle();
				expect(editor.source()).toBe(row.typed);
			});
			it(`${mode}: a composition ${row.name}`, async () => {
				const editor = await placed(row, mode);
				await insertBy('composition', focused(), 'x');
				await editor.settle();
				expect(editor.source()).toBe(row.typed);
			});
		}
});
