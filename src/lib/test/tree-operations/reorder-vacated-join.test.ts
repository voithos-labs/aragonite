import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';

// GH #476: moving a block out from between two blocks rejoined them flush, and the upper one took
// the lower in (a table read as prose, a rule as a setext underline, two quotes as one). The join
// keeps a blank line when either side of the moved block had one; a pair that was flush on both
// sides rejoins, which is what deleting the moved block would leave.
// Miss-analysis: the property suite exempted any rejoined pair from its content check, so a merge
// the move invented passed as the reload's own reading.

const BLOCKS = {
	prose: 'Intro prose that runs on.',
	table: '| A | B |\n| --- | --- |\n| 1 | 2 |',
	image: '![cat](cat.png)',
	divider: '---',
	custom: '<custom-el>\nx',
	list: '- one\n- two',
	quote: '> quoted line'
} as const;

function moveHeadingUp(markdown: string) {
	const doc = parse(markdown);
	reorderChildrenWithTrivia(doc.children, 1, 0, createSharingState(), defaultGrammarView);
	return doc;
}

describe('a move keeps apart the blocks a blank line kept apart (GH #476)', () => {
	it.each([
		['prose', 'table'],
		['prose', 'image'],
		['prose', 'divider'],
		['prose', 'custom'],
		['image', 'image'],
		['list', 'table'],
		['quote', 'table'],
		['quote', 'quote'],
		['prose', 'prose']
	] as const)('%s over %s stays two blocks', (upper, lower) => {
		const [x, y] = [BLOCKS[upper], BLOCKS[lower]];
		const before = parse(`${x}\n\n# Heading\n${y}\n\ntail\n`).children.map((c) => c.kind);

		const doc = moveHeadingUp(`${x}\n\n# Heading\n${y}\n\ntail\n`);

		expect(serialize(doc)).toBe(`# Heading\n\n${x}\n\n${y}\n\ntail\n`);
		expect(doc.children.map((c) => c.kind)).toEqual([before[1], before[0], ...before.slice(2)]);
		expect(describeConvergence(doc)).toBeNull();
	});

	// The same pairs flush on both sides of the heading rejoin as a reload reads the bytes left.
	it.each([
		['two paragraphs', 'a\n# h\nb\n', '# h\na\nb\n'],
		['two quotes', '> a\n# h\n> b\n', '# h\n> a\n> b\n']
	])('%s flush around the moved block rejoin', (_label, markdown, moved) => {
		const doc = moveHeadingUp(markdown);

		expect(serialize(doc)).toBe(moved);
		expect(doc.children).toHaveLength(2);
		expect(describeConvergence(doc)).toBeNull();
	});
});
