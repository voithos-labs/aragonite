// A move that writes a blank line at a join does it through the reorder action, and one undo
// takes the move and the blank line back together.
// Miss-analysis: the join rules were pinned on the tree operation alone, so a move through the
// action with its undo, or a table landing under prose, ran only in a browser.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { makeReorderHarness } from './reorder-harness';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |';

const CASES = [
	{
		label: 'a paragraph moved up out from under an HTML block leaves the quote its own',
		before: 'Intro\n<div>\nx\n</div>\n\nSecond\n> quoted line\n- one\n- two\n',
		move: { path: [2], by: -1 },
		after: 'Intro\n\nSecond\n\n<div>\nx\n</div>\n\n> quoted line\n- one\n- two\n',
		kinds: ['paragraph', 'paragraph', 'htmlBlock', 'blockquote', 'list']
	},
	{
		label: 'a heading moved up leaves a blank line between the paragraph and the table',
		before: `Intro\n\n# Heading\n${TABLE}\n`,
		move: { path: [1], by: -1 },
		after: `# Heading\n\nIntro\n\n${TABLE}\n`,
		kinds: ['heading', 'paragraph', 'table']
	},
	{
		label: 'a table dropped flush under a paragraph stays a table',
		before: `Intro\n# Heading\n\n${TABLE}\n`,
		move: { path: [2], to: 1 },
		after: `Intro\n\n${TABLE}\n\n# Heading\n`,
		kinds: ['paragraph', 'table', 'heading']
	}
] as const;

describe('a move that writes a blank line at a join', () => {
	it.each(CASES)('$label', async ({ before, move, after, kinds }) => {
		const h = makeReorderHarness(before);

		await ('to' in move
			? h.reorder.moveReorderUnit([...move.path], move.to)
			: h.reorder.nudgeReorderUnit([...move.path], move.by));

		expect(serialize(h.doc)).toBe(after);
		expect(h.doc.children.map((c) => c.kind)).toEqual(kinds);
		expectParseConverged(h.doc);
		await h.undo();
		expect(serialize(h.doc)).toBe(before);
	});
});
