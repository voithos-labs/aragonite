import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeReorderContainer } from './reorder-harness';

// GH #477: inside a container the move kept no blank line between the pair it left, so a quote's
// HTML block took the nested quote below it, a paragraph took a table, and two paragraphs a blank
// line kept apart merged. A container's children take the same rule the document's do.
// Miss-analysis: the #461 and #476 pins moved top-level blocks only, and the rule ran only there.

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |';
const quoted = (text: string, indent = '') =>
	text
		.split('\n')
		.map((line) => indent + (line ? `> ${line}` : '>'))
		.join('\n') + '\n';

const SHAPES = [
	{
		label: 'an HTML block over a nested quote',
		before: '<div>\nx\n</div>\n\nSecond\n> inner',
		after: 'Second\n\n<div>\nx\n</div>\n\n> inner',
		kinds: ['paragraph', 'htmlBlock', 'blockquote']
	},
	{
		label: 'a paragraph over a table',
		before: `Intro\n\n# H\n${TABLE}`,
		after: `# H\n\nIntro\n\n${TABLE}`,
		kinds: ['heading', 'paragraph', 'table']
	},
	{
		label: 'two paragraphs a blank line kept apart',
		before: 'a\n\n# h\nb',
		after: '# h\n\na\n\nb',
		kinds: ['heading', 'paragraph', 'paragraph']
	}
];

describe('a move inside a quote keeps apart the blocks a blank line kept apart (GH #477)', () => {
	it.each(SHAPES)('$label', async ({ before, after, kinds }) => {
		const h = makeReorderContainer(quoted(before));

		await h.reorder.moveReorderUnit([0, 1], 0);

		expect(serialize(h.doc)).toBe(quoted(after));
		expect(h.node().children!.map((c) => c.kind)).toEqual(kinds);
		h.assertStable();
		await h.undo();
		expect(serialize(h.doc)).toBe(quoted(before));
	});

	it('rejoins two paragraphs flush on both sides of the moved block', async () => {
		const h = makeReorderContainer(quoted('a\n# h\nb'));

		await h.reorder.moveReorderUnit([0, 1], 0);

		expect(serialize(h.doc)).toBe(quoted('# h\na\nb'));
		h.assertStable();
	});
});

describe('a move inside a quote in a list item takes the same rule (GH #477)', () => {
	it.each(SHAPES)('$label', async ({ before, after, kinds }) => {
		const h = makeReorderContainer(`- item\n\n${quoted(before, '  ')}`, { path: [0, 0, 1] });

		await h.reorder.moveReorderUnit([0, 0, 1, 1], 0);

		expect(serialize(h.doc)).toBe(`- item\n\n${quoted(after, '  ')}`);
		expect(h.node().children!.map((c) => c.kind)).toEqual(kinds);
		h.assertStable();
	});
});
