/**
 * Type pins for a block type's `chords`: a container's keys are chords alone, since the text inside
 * it keeps Enter, Backspace and Delete, while a leaf type may take all three. The `@ts-expect-error`
 * lines are the assertions, so `npm run check` fails if one starts compiling.
 * Miss-analysis: install refused the three on a container, and no pin held the type that offered them.
 */
import { expect, it } from 'vitest';
import { command, container, lineBlock, type Block } from '#lib/plugin.js';

const run = command<Block<never>>({ id: 'run', title: 'Run', run: () => {} });
const insert = { none: 'a type pin' };
const lines = { shape: 'marked', first: '&> ', rest: '&> ', reads: /^&> ?/, lazy: true } as const;
const box = { name: 'box', label: 'Box', sample: '&> x', insert, lines };

// Never called: an outside author's types, written as they would against `/plugin`. A literal
// reports one unknown key, so each refused key has a spec of its own.
export const containerKeys = () => [
	container({ ...box, chords: { 'Mod+7': run, 'Mod+Enter': run, 'Alt+Enter': run } }),
	// @ts-expect-error the text inside a container keeps Enter
	container({ ...box, chords: { 'Mod+7': run, Enter: run } }),
	// @ts-expect-error and Backspace
	container({ ...box, chords: { 'Mod+7': run, Backspace: run } }),
	// @ts-expect-error and Delete
	container({ ...box, chords: { 'Mod+7': run, Delete: run } })
];

export const leafKeys = () =>
	lineBlock({
		name: 'memo',
		label: 'Memo',
		match: /^@@ .*$/,
		sample: '@@ x',
		insert,
		chords: {
			'Mod+7': run,
			'Mod+Enter': run,
			'Alt+Enter': run,
			Enter: run,
			Backspace: run,
			Delete: run
		}
	});

it('compiles the pins above', () => {
	expect([containerKeys, leafKeys]).toHaveLength(2);
});
