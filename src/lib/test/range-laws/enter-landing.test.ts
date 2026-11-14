// @vitest-environment jsdom
// Enter over a range, then a letter, mounted in both modes, by a hardware Enter, a soft keyboard's
// paragraph break and Shift+Enter: where the range entered the block holding the text after it, the
// break goes before that text and the letter lands at it; where it ended between blocks, the break
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
import { mountCase, placeRange, type Editor } from './gestures';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['source', 'live'];
type Break = 'Enter' | 'a soft paragraph break' | 'Shift+Enter';
const BREAKS: Break[] = ['Enter', 'a soft paragraph break', 'Shift+Enter'];

interface Row {
	name: string;
	source: string;
	select: EditorSelection;
	/** The document once Enter (or the soft break) and a letter are in. */
	entered: string;
	/** The same after Shift+Enter. */
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
	}
];

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

async function lineBreak(editor: Editor, by: Break): Promise<void> {
	if (by === 'a soft paragraph break') dispatchBeforeInput(focused(), 'insertParagraph');
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
					expect(editor.source()).toBe(by === 'Shift+Enter' ? row.shifted : row.entered);
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
		key: KeyboardEventInit
	): Promise<string> {
		const editor = mountEditor<EditorTestSurface>({
			source,
			presentationMode: 'source',
			plugins: SYNTAX_PLUGINS,
			keybindings: [binding]
		});
		await editor.settle();
		await placeRange(editor, select);
		await pressHardwareKey(focused(), key);
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
});
