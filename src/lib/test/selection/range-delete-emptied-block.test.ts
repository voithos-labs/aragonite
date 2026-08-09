import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { splitNode, updateNodeContent } from '$lib/tree-operations/node-ops';
import { createSharingState } from '$lib/tree-operations/sharing';
import { expectParseConverged } from '../harness/parse-converged';
import type { Document } from '$lib/core/nodes';

// GH #96 through the delete doors: a selection covering a block's whole text leaves the block
// blank, and a blank block IS the separating line of the one below it — so the line it carried
// and the line below it both stand, and the reload reads the second as an empty paragraph. The
// same-block arm writes raw in place with no settle at all; the cross-block install settled the
// PAIR, which misses a run whose second line sits further down.
// Miss-analysis: every emptied-block case drove the typing door (`updateNodeContent`), and the
// delete cases all deleted whole blocks rather than emptying one, so no case reached either arm.

/** Select a block's whole text and delete it — the Backspace-over-a-selection gesture. */
function emptyBlock(doc: Document, index: number): void {
	const end = doc.children[index].raw.length - 1;
	rangeDelete(
		doc,
		{ path: [index], offset: 0 },
		{ path: [index], offset: end },
		createSharingState(),
		undefined,
		undefined,
		undefined
	);
}

/** [Hello, x('\n'), blank(''), Second('\n')] — the split shape, whose run line sits two below. */
function splitShape(): Document {
	const doc = parse('Hello\n\nSecond\n');
	splitNode(doc, 0, 5, undefined, undefined);
	splitNode(doc, 1, 0, undefined, undefined);
	updateNodeContent(doc, 1, 'x\n');
	return doc;
}

describe('a delete that empties a block settles the run it joins', () => {
	it('drops the separator its follower already carries', () => {
		const doc = parse('alpha\n\nx\n\ndelta\n');

		emptyBlock(doc, 1);

		expect(serialize(doc)).toBe('alpha\n\n\ndelta\n');
		expect(doc.children).toHaveLength(3);
		expectParseConverged(doc);
	});

	it('drops the follower separator when a blank block already opens the run', () => {
		const doc = parse('a\n\n\nx\n\nb\n');

		emptyBlock(doc, 2);

		expect(serialize(doc)).toBe('a\n\n\n\nb\n');
		expectParseConverged(doc);
	});

	it('reaches past a blank follower to the separator a split left below it', () => {
		const doc = splitShape();

		emptyBlock(doc, 1);

		expect(serialize(doc)).toBe('Hello\n\n\n\nSecond\n');
		expectParseConverged(doc);
	});

	// The endpoint install is the cross-block twin of the arm above: the start block survives as a
	// truncation, and an empty one joins the same run.
	it('settles a cross-block delete whose surviving start block is empty', () => {
		const doc = splitShape();

		rangeDelete(
			doc,
			{ path: [1], offset: 0 },
			{ path: [2], offset: 0 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(doc.children.map((c) => c.raw)).toEqual(['Hello\n', '\n', 'Second\n']);
		expectParseConverged(doc);
	});
});
