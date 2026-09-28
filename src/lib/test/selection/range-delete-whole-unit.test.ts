import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { coverRange } from '$lib/selection/range-coverage';
import { createSharingState } from '$lib/tree-operations/sharing';
import { expectParseConverged } from '../harness/parse-converged';
import type { Document } from '$lib/core/nodes';
import type { SelectionPoint } from '$lib/selection/primitives';
import { fixtureReading } from '../harness/fixture-grammar';

// A block with no positions inside it (a rule, a diagram) is in a range whole or not at all, so
// a range that covers it deletes the node: the same-block branch's byte write would leave a rule
// holding a bare line ending, which no reload reads as a rule.
// Miss-analysis: every same-block fixture was text, whose emptied survivor is a legal block.

function del(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc: Document = parse(source);
	const result = rangeDelete(
		doc,
		coverRange(doc, start, end),
		createSharingState(),
		fixtureReading()
	);
	return { doc, caret: result.collapsedCaret };
}

describe('a range covering a whole-block-focus leaf deletes the node', () => {
	it('removes a top-level rule and lands at the end of the block above', () => {
		const { doc, caret } = del(
			'lead\n\n---\n\ntail\n',
			{ path: [1], offset: 0 },
			{ path: [1], offset: 3 }
		);

		expect(serialize(doc)).toBe('lead\n\ntail\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
		expect(caret).toEqual({ path: [0], offset: 'lead'.length });
		expectParseConverged(doc);
	});

	it('removes a rule that ends the document and lands at the end of the block above', () => {
		const { doc, caret } = del('lead\n\n---\n', { path: [1], offset: 0 }, { path: [1], offset: 3 });

		expect(serialize(doc)).toBe('lead\n');
		expect(caret).toEqual({ path: [0], offset: 'lead'.length });
		expectParseConverged(doc);
	});

	// Miss-analysis: every neighbour here was a paragraph, so a caret aimed at a list's own path,
	// whose wrapper holds no caret, never showed up.
	it('with nothing above, lands in the first item of the list below', () => {
		const { doc, caret } = del('---\n\n- a\n', { path: [0], offset: 0 }, { path: [0], offset: 3 });

		expect(serialize(doc)).toBe('- a\n');
		expect(caret).toEqual({ path: [0, 0, 0], offset: 0 });
	});

	it('removes a rule inside a quote and rebuilds the quote', () => {
		const { doc } = del(
			'> a\n>\n> ---\n>\n> b\n',
			{ path: [0, 1], offset: 0 },
			{ path: [0, 1], offset: 3 }
		);

		expect(serialize(doc)).toBe('> a\n>\n> b\n');
		expectParseConverged(doc);
	});

	// The branch's ordinary behaviour stands for text: a paragraph emptied by its range is a
	// legal blank block, and the block after it keeps its own line.
	it('still leaves an emptied paragraph in place', () => {
		const { doc } = del(
			'lead\n\nmid\n\ntail\n',
			{ path: [1], offset: 0 },
			{ path: [1], offset: 3 }
		);

		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph', 'paragraph']);
		expectParseConverged(doc);
	});
});
