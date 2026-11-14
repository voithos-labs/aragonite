// @vitest-environment jsdom
// A line break over a range, then a letter, mounted in both modes, by Enter and Shift+Enter and a
// soft keyboard's two breaks: where the range ended in a leaf's text, the break goes before what is
// left of it and the letter lands there; where it ended at a leaf's end or between blocks, the break
// stands at the end of the block before; a container's opening line never takes it.
// Miss-analysis: the mounted rows typed after Delete alone, and Enter's removal landed as Backspace's,
// so its key pressed on a kept opening line and descended onto the next one.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import { SYNTAX_PLUGINS } from '#lib/test/behavior/corpus.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchBeforeInput, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import { mountCase, placeRange, type Editor } from './gestures';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['source', 'live'];
type Break = 'Enter' | 'a soft paragraph break' | 'Shift+Enter' | 'a soft line break';
const BREAKS: Break[] = ['Enter', 'a soft paragraph break', 'Shift+Enter', 'a soft line break'];

interface Row {
	name: string;
	source: string;
	select: EditorSelection;
	/** The document once Enter (or the soft break) and a letter are in. */
	entered: string;
	/** The same after Shift+Enter or a soft line break. */
	shifted: string;
}

const from = (path: number[]) => ({ path, offset: 0 });
const range = (anchor: number[], focus: number[], offset: number): EditorSelection => ({
	anchor: from(anchor),
	focus: { path: focus, offset }
});

const ROWS: Row[] = [
	{
		name: 'two openings entered',
		source: '***\n\nbody\n\n::::note\n:::note\ninner\nmore\n:::\n::::\n\n# h\n',
		select: range([0], [2, 1, 1], 2),
		entered: '::::note\n:::note\n\n\nxner\nmore\n:::\n::::\n\n# h\n',
		shifted: '::::note\n:::note\n\\\nxner\nmore\n:::\n::::\n\n# h\n'
	},
	{
		name: 'an open details entered inside a note',
		source:
			'***\n\nbody\n\n:::note\n<details open>\n<summary>Sum</summary>\n\ninner\nmore\n\n</details>\n:::\n',
		select: range([0], [2, 1, 1], 2),
		entered: ':::note\n<details open>\n<summary>Sum</summary>\n\n\nxner\nmore\n\n</details>\n:::\n',
		shifted: ':::note\n<details open>\n<summary>Sum</summary>\n\\\nxner\nmore\n\n</details>\n:::\n'
	},
	{
		name: 'a tip entered from a note',
		source: ':::note\n***\n\nbody\n:::\n\n:::tip\ninner\n:::\n',
		select: range([0, 1], [1, 1], 2),
		entered: ':::note\n:::\n\n:::tip\n\n\nxner\n:::\n',
		shifted: ':::note\n:::\n\n:::tip\n\\\nxner\n:::\n'
	},
	{
		name: 'an item’s first line taken in a note',
		source: '***\n\nbody\n\n:::note\n- inner\n  more\n:::\n',
		select: range([0], [2, 1, 0, 0], 5),
		entered: ':::note\n\n  \nxmore\n:::\n',
		shifted: ':::note\n  \\\nxmore\n:::\n'
	},
	{
		name: 'the same in an open details',
		source:
			'***\n\nbody\n\n<details open>\n<summary>Sum</summary>\n\n- inner\n  more\n\n</details>\n',
		select: range([0], [2, 1, 0, 0], 5),
		entered: '<details open>\n<summary>Sum</summary>\n\n  \nxmore\n\n</details>\n',
		shifted: '<details open>\n<summary>Sum</summary>\n  \\\nxmore\n\n</details>\n'
	},
	{
		name: 'an item’s first line taken from inside a note',
		source: ':::note\n***\n\nbody\n\n- inner\n  more\n:::\n',
		select: range([0, 1], [0, 3, 0, 0], 5),
		entered: ':::note\n\n  \nxmore\n:::\n',
		shifted: ':::note\n  \\\nxmore\n:::\n'
	},
	{
		name: 'a quote entered, the range ending at its first paragraph’s end, before the next one',
		source: 'first\n\n***\n\nbody\n\n> one\n>\n> two\n',
		select: range([1], [3, 0], 3),
		entered: 'first\n\nx\n\n> two\n',
		shifted: 'first\\\nx\n\n> two\n'
	},
	{
		name: 'a list entered, the range ending at its first item’s end, before the next item',
		source: 'first\n\n***\n\nbody\n\n- a\n- b\n',
		select: range([1], [3, 0, 0], 1),
		entered: 'first\n\nx\n\n- b\n',
		shifted: 'first\\\nx\n\n- b\n'
	},
	{
		name: 'a range ending between blocks, before a quote',
		source: 'first\n\n***\n\npara\n\n> quote\n',
		select: range([1], [2], 4),
		entered: 'first\n\nx\n\n> quote\n',
		shifted: 'first\\\nx\n\n> quote\n'
	},
	{
		name: 'a range ending between blocks, before a tip',
		source: 'first\n\n***\n\npara\n\n:::tip\nbody\n:::\n',
		select: range([1], [2], 4),
		entered: 'first\n\nx\n\n:::tip\nbody\n:::\n',
		shifted: 'first\\\nx\n\n:::tip\nbody\n:::\n'
	},
	{
		name: 'a tip’s opening line right after the range, at the document’s start',
		source: '***\n\npara\n\n:::tip\nbody\n:::\n',
		select: range([0], [1], 4),
		entered: 'x\n\n:::tip\nbody\n:::\n',
		shifted: 'x\n\n:::tip\nbody\n:::\n'
	},
	// Miss-analysis: every row ended where the claimed block binds Shift+Enter, and a title row binds
	// none, so a line break that came as input took Backspace's side and typed on the opening line.
	{
		name: 'a title the range ends in, at the document’s start',
		source: '***\n\nbody\n\n:::tip Title\nbody\n:::\n',
		select: range([0], [2, 0], 9),
		entered: 'x\n\n:::tip tle\nbody\n:::\n',
		shifted: 'x\n\n:::tip tle\nbody\n:::\n'
	},
	{
		name: 'a summary the range ends in, at the document’s start',
		source: '***\n\nbody\n\n<details open>\n<summary>Sum</summary>\n\nbody\n\n</details>\n',
		select: range([0], [2, 0], 2),
		entered: 'x\n\n<details open>\n<summary>m</summary>\n\nbody\n\n</details>\n',
		shifted: 'x\n\n<details open>\n<summary>m</summary>\n\nbody\n\n</details>\n'
	},
	{
		name: 'an untitled opening line the range ends at, a block before',
		source: 'first\n\n***\n\nbody\n\n:::tip\nbody\n:::\n',
		select: range([1], [3, 0], 6),
		entered: 'first\n\nx\n\n\n:::tip\nbody\n:::\n',
		shifted: 'first\\\nx\n\n\n:::tip\nbody\n:::\n'
	},
	// Miss-analysis: every row took the block its range started in, so a break that ran where the
	// range began, on a title row the core never picked, went unseen and its guard warned there.
	{
		name: 'a range starting in a title, into its body',
		source: ':::tip Title\nbody\n:::\n',
		select: { anchor: { path: [0, 0], offset: 9 }, focus: { path: [0, 1], offset: 2 } },
		entered: ':::tip Ti\nxdy\n:::\n',
		shifted: ':::tip Tix\ndy\n:::\n'
	}
];

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

async function lineBreak(editor: Editor, by: Break): Promise<void> {
	if (by === 'a soft paragraph break') dispatchBeforeInput(focused(), 'insertParagraph');
	else if (by === 'a soft line break') dispatchBeforeInput(focused(), 'insertLineBreak');
	else await pressHardwareKey(focused(), { key: 'Enter', shiftKey: by === 'Shift+Enter' });
	await editor.settle();
}

describe('Enter over a range, then a letter', () => {
	for (const mode of MODES)
		for (const row of ROWS)
			for (const by of BREAKS) {
				it(`${mode}: ${row.name}, ${by}`, async () => {
					const editor = mountCase(row.source, mode);
					await editor.settle();
					await placeRange(editor, row.select);
					await lineBreak(editor, by);
					await pressHardwareKey(focused(), { key: 'x' });
					await editor.settle();
					const shifted = by === 'Shift+Enter' || by === 'a soft line break';
					expect(editor.source()).toBe(shifted ? row.shifted : row.entered);
				});
			}
});

// Miss-analysis: every row pressed the key the default keymap binds to its break, so a break named
// by its chord, and not by the command the chord runs, passed them all.
describe('a line break over a range goes by the command its key runs', () => {
	async function pressed(
		source: string,
		select: EditorSelection,
		binding: KeybindingOverride,
		key: KeyboardEventInit | 'insertParagraph'
	): Promise<string> {
		await destroyMountedEditors();
		const editor = mountEditor<EditorTestSurface>({
			source,
			presentationMode: 'source',
			plugins: SYNTAX_PLUGINS,
			keybindings: [binding]
		});
		await editor.settle();
		await placeRange(editor, select);
		if (key === 'insertParagraph') dispatchBeforeInput(focused(), key);
		else await pressHardwareKey(focused(), key);
		await editor.settle();
		await pressHardwareKey(focused(), { key: 'x' });
		await editor.settle();
		return editor.source();
	}

	it('another chord bound to the split breaks before the text, as Enter does', async () => {
		const typed = await pressed(
			'***\n\nbody\n\n:::tip\ninner\nmore\n:::\n',
			range([0], [2, 1], 2),
			{ kind: 'paragraph', chord: 'Mod+J', command: 'block.split' },
			{ key: 'j', ctrlKey: true }
		);
		expect(typed).toBe(':::tip\n\n\nxner\nmore\n:::\n');
	});

	it('Enter bound to a heading level lands where Backspace would, as that command does', async () => {
		const typed = await pressed(
			'first\n\n***\n\nbody\n\n> ***\n>\n> more\n',
			range([1], [3, 0], 3),
			{ kind: 'paragraph', chord: 'Enter', command: 'heading.cycle', arg: 2 },
			{ key: 'Enter' }
		);
		expect(typed).toBe('## firstx\n\n> more\n');
	});

	// Miss-analysis: no row sent a soft keyboard's break under a rebound key, so a break input named a
	// line break whatever its chord runs went unseen.
	it('a soft keyboard’s paragraph break goes by what Enter is bound to, as the key does', async () => {
		const source = 'first\n\n***\n\nbody\n\n:::tip\ninner\n:::\n';
		const select = range([1], [3, 1], 2);
		const binding: KeybindingOverride = {
			kind: 'paragraph',
			chord: 'Enter',
			command: 'heading.cycle',
			arg: 2
		};
		const keyed = await pressed(source, select, binding, { key: 'Enter' });
		expect(keyed.startsWith('## firstx\n')).toBe(true);
		expect(await pressed(source, select, binding, 'insertParagraph')).toBe(keyed);
	});
});

// Miss-analysis: no row sent a break as input where its key runs nothing, or began at the first byte
// of a block the removal takes whole, so a check read off the removal's name or the edge passed.
describe('G1.223 reads the keymap of the block a line break ran in', () => {
	it('a soft paragraph break left on a rule, which binds no Enter, fires it', async () => {
		const editor = mountCase('***\n\n# head\n\nbody\n\nafter\n', 'source');
		await editor.settle();
		await placeRange(editor, range([1], [2], 4));
		await lineBreak(editor, 'a soft paragraph break');
		expect(takeDevWarnsOf('invariant:range-break-landing')).toHaveLength(1);
	});
});
