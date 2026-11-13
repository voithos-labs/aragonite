// @vitest-environment jsdom
// Delete over a range that takes the blocks it starts in whole and runs into a later container, then
// a letter, mounted in both modes: the letter lands at the text the range left after its end, never
// on an opening line the removal kept, and a composition lands where Delete does. A line the removal
// emptied where the range started keeps the caret instead.
// Miss-analysis: the range rows stated bytes alone, so none typed after a Delete whose range entered a
// container, where the caret stopped on the container's opening line.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { mountCase, placeRange, type Editor } from './gestures';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['source', 'live'];
const NOTE = ':::note\n***\n\nbody\n:::\n\n';
const FROM_RULE = { path: [0, 1], offset: 0 };

interface Row {
	name: string;
	source: string;
	select: EditorSelection;
	/** The document once the gesture and the letter are in. */
	typed: string;
	composes?: boolean;
}

const to = (path: number[], offset: number) => ({ anchor: FROM_RULE, focus: { path, offset } });

const ROWS: Row[] = [
	{
		name: 'into a tip’s body',
		source: `${NOTE}:::tip\ninner\nmore\n:::\n\n# h\n`,
		select: to([1, 1], 2),
		typed: ':::note\n:::\n\n:::tip\nxner\nmore\n:::\n\n# h\n',
		composes: true
	},
	{
		name: 'from the document’s first block into a tip’s body',
		source: '***\n\nbody\n\n:::tip\ninner\nmore\n:::\n\n# h\n',
		select: { anchor: { path: [0], offset: 0 }, focus: { path: [2, 1], offset: 2 } },
		typed: ':::tip\nxner\nmore\n:::\n\n# h\n'
	},
	{
		name: 'into a tip inside a note',
		source: `${NOTE}::::note\n:::tip\ninner\n:::\n::::\n\n# h\n`,
		select: to([1, 1, 1], 2),
		typed: ':::note\n:::\n\n::::note\n:::tip\nxner\n:::\n::::\n\n# h\n'
	},
	{
		name: 'into a titled tip’s body',
		source: `${NOTE}:::tip Title\ninner\n:::\n\n# h\n`,
		select: to([1, 1], 2),
		typed: ':::note\n:::\n\n:::tip Title\nxner\n:::\n\n# h\n'
	},
	{
		name: 'into a tip’s title',
		source: `${NOTE}:::tip Title\ninner\n:::\n\n# h\n`,
		select: to([1, 0], 9),
		typed: ':::note\n:::\n\n:::tip xtle\ninner\n:::\n\n# h\n'
	},
	{
		name: 'to a tip’s title end',
		source: `${NOTE}:::tip\ninner\n:::\n\n# h\n`,
		select: to([1, 0], 6),
		typed: ':::note\n:::\n\n:::tip\nxinner\n:::\n\n# h\n'
	},
	{
		name: 'into an item in a tip',
		source: `${NOTE}:::tip\n- inner\n:::\n\n# h\n`,
		select: to([1, 1, 0, 0], 2),
		typed: ':::note\n:::\n\n:::tip\n- xner\n:::\n\n# h\n'
	},
	{
		name: 'into a quote in a tip',
		source: `${NOTE}:::tip\n> inner\n:::\n\n# h\n`,
		select: to([1, 1, 0], 2),
		typed: ':::note\n:::\n\n:::tip\n> xner\n:::\n\n# h\n'
	},
	{
		name: 'past a rule in a tip',
		source: `${NOTE}:::tip\n***\n\ninner\n:::\n\n# h\n`,
		select: to([1, 2], 2),
		typed: ':::note\n:::\n\n:::tip\nxner\n:::\n\n# h\n'
	},
	{
		name: 'into a code block in a tip',
		source: `${NOTE}:::tip\n\`\`\`\ncode\n\`\`\`\n:::\n\n# h\n`,
		select: to([1, 1], 6),
		typed: ':::note\n:::\n\n:::tip\n```\nxde\n```\n:::\n\n# h\n'
	},
	{
		name: 'into an open details’ body',
		source: `${NOTE}<details open>\n<summary>Sum</summary>\n\ninner\n\n</details>\n\n# h\n`,
		select: to([1, 1], 2),
		typed: ':::note\n:::\n\n<details open>\n<summary>Sum</summary>\nxner\n\n</details>\n\n# h\n'
	},
	{
		name: 'out of a quote it empties, which keeps the caret',
		source: '> ```\n> code\n> ```\n>\n> body\n\n:::tip Title\ninner\n:::\n\n# h\n',
		select: { anchor: { path: [0, 0], offset: 0 }, focus: { path: [1, 0], offset: 9 } },
		typed: '> x\n\n:::tip tle\ninner\n:::\n\n# h\n',
		composes: true
	}
];

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

async function key(editor: Editor, name: string): Promise<void> {
	await pressHardwareKey(focused(), { key: name });
	await editor.settle();
}

describe('Delete over a range into a later container, then a letter', () => {
	for (const mode of MODES)
		for (const row of ROWS) {
			it(`${mode}: ${row.name}`, async () => {
				const editor = mountCase(row.source, mode);
				await editor.settle();
				await placeRange(editor, row.select);
				await key(editor, 'Delete');
				await key(editor, 'x');
				expect(editor.source()).toBe(row.typed);
			});
			if (!row.composes) continue;
			it(`${mode}: a composition ${row.name}`, async () => {
				const editor = mountCase(row.source, mode);
				await editor.settle();
				await placeRange(editor, row.select);
				await insertBy('composition', focused(), 'x');
				await editor.settle();
				expect(editor.source()).toBe(row.typed);
			});
		}
});
