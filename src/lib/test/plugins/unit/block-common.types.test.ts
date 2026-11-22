/**
 * Type pins for what every block type answers: a menu row's label may read the block it opened
 * over. The `@ts-expect-error` lines are the assertions, so `npm run check` fails if one starts
 * compiling, and so does a line above them that stops.
 * Miss-analysis: a row's label was a string alone, and no pin held the function an author writes.
 */
import { expect, it } from 'vitest';
import { command, container, type Block } from '#lib/plugin.js';

const lines = {
	shape: 'marked',
	first: '&> ',
	rest: '&> ',
	reads: /^&> ?/,
	lazy: true,
	head: {
		match: /^\[!(\w+)\]$/,
		data: (m: RegExpExecArray) => ({ type: m[1] }),
		write: (data: { type: string }) => `[!${data.type}]`
	}
} as const;
const alert = { name: 'alert', label: 'Alert', sample: '&> [!NOTE]', insert: { none: 'a pin' } };
const cycle = command<Block<{ type: string }>>({ id: 'cycle', title: 'Next', run: () => {} });

// Never called: an outside author's types, written as they would against `/plugin`.
export const labels = () => [
	container({ ...alert, lines, actions: [{ label: 'Next kind', command: cycle }] }),
	container({
		...alert,
		lines,
		actions: [{ label: (b) => `After ${b.data.type}`, command: cycle }]
	}),
	// @ts-expect-error a label answers text
	container({ ...alert, lines, actions: [{ label: () => 42, command: cycle }] })
];

it('compiles the pins above', () => {
	expect(labels).toBeTypeOf('function');
});
