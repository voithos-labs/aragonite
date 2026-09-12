import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { expectParseConverged } from '../harness/parse-converged';
import type { Document } from '$lib/core/nodes';
import type { SelectionPoint } from '$lib/selection/primitives';

// A block with no positions inside it (a rule, a diagram) is in a range whole or not at all, so
// a range that covers it deletes the NODE: the same-block arm's byte write would leave a rule
// holding a bare line ending, which no reload reads as a rule.
// Miss-analysis: every same-block fixture was prose, whose emptied survivor is a legal block;
// the whole-unit drag was the first gesture to hand this arm a kind that has no empty form.

function del(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc: Document = parse(source);
	const result = rangeDelete(
		doc,
		start,
		end,
		createSharingState(),
		undefined,
		undefined,
		undefined
	);
	return { doc, caret: result.collapsedCaret };
}

describe('a range covering a whole-block-focus leaf deletes the node', () => {
	it('removes a top-level rule and lands on the block that takes its slot', () => {
		const { doc, caret } = del(
			'lead\n\n---\n\ntail\n',
			{ path: [1], offset: 0 },
			{ path: [1], offset: 3 }
		);

		expect(serialize(doc)).toBe('lead\n\ntail\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
		expect(caret).toEqual({ path: [1], offset: 0 });
		expectParseConverged(doc);
	});

	it('removes a rule that ends the document and lands on the block above', () => {
		const { doc, caret } = del('lead\n\n---\n', { path: [1], offset: 0 }, { path: [1], offset: 3 });

		expect(serialize(doc)).toBe('lead\n');
		expect(caret).toEqual({ path: [0], offset: 0 });
		expectParseConverged(doc);
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

	// The arm's ordinary reading stands for prose: a paragraph emptied by its range is a legal
	// blank block, and the follower keeps its own line.
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
