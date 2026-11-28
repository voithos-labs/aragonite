// @vitest-environment jsdom
// A heading key or the toolbar's heading command over a range across blocks gives each text block
// it reaches the bytes the in-block command writes (a set, never a toggle), deletes nothing, keeps
// the range over the same text and undoes in one step. A block with no text keeps its bytes.
// Miss-analysis: the heading level ran after the range's removal, and the rows pinned that removal
// (`## ` where two blocks stood), so no row asked for the blocks' text to stay.
import { tick } from 'svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { makeKeydownEnv, press } from './keydown-env';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { mountCase, placeOwnedRange } from '../../range-laws/gestures';

beforeAll(installLayoutStubs);

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

interface Row {
	name: string;
	source: string;
	from: SelectionPoint;
	to: SelectionPoint;
	after: string;
	/** The range after the key, where a row checks it. */
	kept?: [SelectionPoint, SelectionPoint];
	key?: string;
}

const MIX = 'first\n\n## head\n\nbody\n\nlast\n';
const TABLE = 'first\n\n| a |\n| - |\n| b |\n\nlast\n';

const ROWS: Row[] = [
	{
		name: 'an H2 and a paragraph whole give two H2s',
		source: MIX,
		from: at([1], 0),
		to: at([2], 4),
		after: 'first\n\n## head\n\n## body\n\nlast\n',
		kept: [at([1], 0), at([2], 7)]
	},
	{
		name: 'two H2s stay H2s',
		source: '## one\n\n## two\n',
		from: at([0], 0),
		to: at([1], 6),
		after: '## one\n\n## two\n'
	},
	{
		name: 'Mod+0 strips them',
		source: MIX,
		from: at([1], 0),
		to: at([2], 4),
		after: 'first\n\nhead\n\nbody\n\nlast\n',
		key: '0'
	},
	{
		name: 'a closing run stays',
		source: '## a ##\n\nbody\n',
		from: at([0], 0),
		to: at([1], 4),
		after: '### a ##\n\n### body\n',
		key: '3'
	},
	{
		name: 'a setext heading becomes ATX',
		source: 'head\n===\n\nbody\n',
		from: at([0], 0),
		to: at([1], 4),
		after: '## head\n\n## body\n'
	},
	{
		name: 'ends mid-block re-kind every block reached',
		source: MIX,
		from: at([0], 2),
		to: at([2], 2),
		after: '## first\n\n## head\n\n## body\n\nlast\n',
		kept: [at([0], 5), at([2], 5)]
	},
	{
		name: 'an end at a block’s first byte reaches none of it',
		source: 'first\n\nbody\n\nlast\n',
		from: at([0], 2),
		to: at([2], 0),
		after: '## first\n\n## body\n\nlast\n'
	},
	{
		name: 'a start at a block’s end reaches none of it',
		source: 'first\n\nbody\n',
		from: at([0], 5),
		to: at([1], 2),
		after: 'first\n\n## body\n'
	},
	{
		name: 'a divider is skipped',
		source: 'first\n\n***\n\nlast\n',
		from: at([0], 2),
		to: at([2], 2),
		after: '## first\n\n***\n\n## last\n'
	},
	{
		name: 'a code block is skipped',
		source: 'first\n\n```\ncode\n```\n\nlast\n',
		from: at([0], 2),
		to: at([2], 2),
		after: '## first\n\n```\ncode\n```\n\n## last\n'
	},
	{
		name: 'a table is skipped',
		source: 'first\n\n| a |\n| - |\n| b |\n\nlast\n',
		from: at([0], 2),
		to: at([2], 2),
		after: '## first\n\n| a |\n| - |\n| b |\n\n## last\n'
	},
	{
		name: 'from a fence’s first byte',
		source: 'first\n\n```\ncode\n```\n\npara\n',
		from: at([1], 0),
		to: at([2], 2),
		after: 'first\n\n```\ncode\n```\n\n## para\n'
	},
	{
		name: 'a divider held whole and a heading',
		source: 'first\n\n***\n\n# head\n\nlast\n',
		from: at([1], 0),
		to: at([2], 6),
		after: 'first\n\n***\n\n## head\n\nlast\n'
	},
	{
		name: 'a divider flush under a paragraph',
		source: 'first\n***\n\npara\n',
		from: at([1], 0),
		to: at([2], 2),
		after: 'first\n***\n\n## para\n'
	},
	{
		name: 'two list items',
		source: '- one\n- two\n\nlast\n',
		from: at([0, 0, 0], 1),
		to: at([0, 1, 0], 2),
		after: '- ## one\n- ## two\n\nlast\n',
		kept: [at([0, 0, 0], 4), at([0, 1, 0], 5)]
	},
	{
		name: 'two quote paragraphs',
		source: '> one\n>\n> two\n\nlast\n',
		from: at([0, 0], 1),
		to: at([0, 1], 2),
		after: '> ## one\n>\n> ## two\n\nlast\n'
	},
	{
		name: 'two to-dos keep their boxes',
		source: '- [ ] one\n- [ ] two\n',
		from: at([0, 0, 0], 1),
		to: at([0, 1, 0], 2),
		after: '- [ ] one\n- [ ] two\n'
	},
	{
		name: 'a list item and a paragraph after',
		source: '- one\n\nlast\n',
		from: at([0, 0, 0], 1),
		to: at([1], 2),
		after: '- ## one\n\n## last\n'
	},
	{
		name: 'a paragraph of two lines splits, its rest a block of its own',
		source: 'a\nb\n\nlast\n',
		from: at([0], 0),
		to: at([1], 2),
		after: '## a\n\nb\n\n## last\n'
	}
];

describe('a heading key over a range re-kinds each text block it reaches', () => {
	it.each(ROWS)('$name', async ({ source, from, to, after, kept, key }) => {
		const env = makeKeydownEnv(source);
		env.selection.enterCrossBlock(from, to);

		const e = press(key ?? '2', { ctrlKey: true });
		await env.keydown.handleKeyDown(e);

		expect(e.defaultPrevented, 'the key is taken').toBe(true);
		expect(env.source()).toBe(after);
		expect(describeConvergence(env.deps.doc)).toBeNull();
		expect(env.selection.ownsRange, 'the range stays').toBe(true);
		if (kept) {
			expect([env.selection.anchor, env.selection.focus].map((p) => [p?.path, p?.offset])).toEqual(
				kept.map((p) => [p.path, p.offset])
			);
		}
		await createHistoryActions(env.deps, env.controller).requestUndo();
		expect(env.source(), 'one undo').toBe(source);
	});

	it('a divider held whole alone takes the key and writes nothing', async () => {
		const env = makeKeydownEnv('first\n\n***\n\nlast\n');
		const whole = { path: [1], wholeBlock: true as const };
		env.selection.enterCrossBlock(whole, whole);
		const e = press('2', { ctrlKey: true });
		await env.keydown.handleKeyDown(e);
		expect(e.defaultPrevented).toBe(true);
		expect(env.source()).toBe('first\n\n***\n\nlast\n');
		expect(env.selection.wholeUnitPath).toEqual([1]);
	});

	it.each([
		['a paragraph', 'alpha beta\n', [0], '## alpha beta\n'],
		['a to-do', '- [ ] alpha beta\n', [0, 0, 0], '- ## alpha beta\n']
	])(
		'over a finger’s word in %s the block runs the key, as on the browser’s range',
		async (_, source, path, after) => {
			const editor = mountCase(source, 'source');
			await editor.settle();
			const owned = await placeOwnedRange(editor, { anchor: at(path, 0), focus: at(path, 5) });
			expect(owned).toBe(true);
			await pressHardwareKey(document.activeElement as HTMLElement, { key: '2', ctrlKey: true });
			await editor.settle();
			expect(editor.source()).toBe(after);
			await destroyMountedEditors();
		}
	);

	it('a kind that binds the key to nothing keeps its kind', async () => {
		const env = makeKeydownEnv(MIX, {
			keybindings: [{ chord: 'Mod+2', command: null, kind: 'paragraph' }]
		});
		env.selection.enterCrossBlock(at([0], 0), at([2], 4));
		await env.keydown.handleKeyDown(press('2', { ctrlKey: true }));
		expect(env.source()).toBe(MIX);
	});

	it.each([
		[MIX, at([1], 0), at([2], 4), 'first\n\n## head\n\n## body\n\nlast\n'],
		[TABLE, at([0], 2), at([2], 2), '## first\n\n| a |\n| - |\n| b |\n\n## last\n']
	])(
		'the toolbar’s heading command does what the key does: %j',
		async (source, from, to, after) => {
			const env = makeKeydownEnv(source);
			env.selection.enterCrossBlock(from, to);
			expect(env.crossBlockCommands.canRun('heading.cycle')).toBe(true);
			expect(env.crossBlockCommands.run('heading.cycle', 2)).toBe(true);
			for (let i = 0; i < 4; i++) await tick();
			expect(env.source()).toBe(after);
		}
	);
});
