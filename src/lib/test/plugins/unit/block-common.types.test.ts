/**
 * Type pins for what every block type answers: a menu row's label may read the block it opened
 * over, a type's icon may be its own SVG, and its height may read the editor's metrics. The
 * `@ts-expect-error` lines are the assertions, so `npm run check` fails if one starts compiling,
 * and so does a line above them that stops.
 * Miss-analysis: a row's label was a string alone, a type's icon a glyph's name alone and its
 * height a function of the block alone, and no pin held what an author writes beyond them.
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

export const icons = () => [
	container({ ...alert, lines, icon: 'text-quote' }),
	container({ ...alert, lines, icon: { svg: '<svg viewBox="0 0 24 24"></svg>' } }),
	// @ts-expect-error an icon is a glyph's name or `{ svg }`
	container({ ...alert, lines, icon: { path: 'M0 0' } })
];

// A height written before it took the metrics still compiles.
export const heights = () => [
	container({ ...alert, lines, height: () => 320 }),
	container({ ...alert, lines, height: (block) => block.text.length }),
	container({ ...alert, lines, height: (_block, metrics) => metrics.width / 2 }),
	// @ts-expect-error the editor's metrics are read-only
	container({ ...alert, lines, height: (_block, metrics) => (metrics.width = 1) })
];

it('compiles the pins above', () => {
	expect([labels, icons, heights]).toHaveLength(3);
});
