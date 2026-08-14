import { describe, it, expect } from 'vitest';
import type { Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeIntoPrevDeepLeaf, mergeWithNext, mergeWithPrevious } from '$lib/tree-operations';
import type { BodyParent } from '$lib/tree-operations/node-ops';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// GH #166. Miss-analysis: G2.13's gesture lane drove split, delete and content commits but no
// merge, so no oracle ever read a merged tree back — the forward sink's own dev warn was the
// only witness of the dropped line, and the deep-leaf sink had none at all.

/** A heading whose join with the paragraph below reads as TWO blocks: `# htext` then `more`. */
const HEADING_OVER_TWO_LINES = '# h\ntext\nmore\n';
const QUOTED = '> # h\n> text\n> more\n';

/** The blockquote's body as a parent the primitives write, plus the doc holding it. */
function quotedBody(): { doc: Document; body: BodyParent } {
	const doc = parse(QUOTED);
	const quote = doc.children[0];
	return {
		doc,
		body: { children: quote.children!, ownerKind: quote.kind, owner: quote }
	};
}

describe('a join whose bytes read as several blocks is refused, not truncated', () => {
	it('declines the forward join rather than dropping every block past the first', () => {
		const doc = parse(HEADING_OVER_TWO_LINES);

		const { change } = mergeWithNext(doc, 0, undefined, undefined);

		expect(change).toEqual({ op: 'noop' });
		expect(serialize(doc)).toBe(HEADING_OVER_TWO_LINES);
		expect(doc.children).toHaveLength(2);
	});

	it('declines the backward join rather than writing a leaf its own reload disagrees with', () => {
		const doc = parse(HEADING_OVER_TWO_LINES);

		expect(mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined, undefined)).toBeNull();

		expect(serialize(doc)).toBe(HEADING_OVER_TWO_LINES);
		expect(doc.children).toHaveLength(2);
		expectParseConverged(doc);
	});

	it('declines the reparse-both-halves join at the same boundary', () => {
		const doc = parse(HEADING_OVER_TWO_LINES);

		const { change } = mergeWithPrevious(doc, 1, undefined, undefined);

		expect(change).toEqual({ op: 'noop' });
		expect(serialize(doc)).toBe(HEADING_OVER_TWO_LINES);
	});

	// Bytes are no oracle here: a body merge writes the quote's CHILDREN and never rebuilds the
	// container's own raw, so `serialize` reads back the source whatever the sink did. What can
	// fail is the change descriptor and the reload, which is what a truncation would break.
	it('declines both directions inside a blockquote body', () => {
		const forward = quotedBody();
		expect(mergeWithNext(forward.body, 0, undefined, undefined).change).toEqual({ op: 'noop' });
		expect(forward.body.children).toHaveLength(2);
		expectParseConverged(forward.doc);

		const backward = quotedBody();
		expect(mergeIntoPrevDeepLeaf(backward.body, 1, undefined, undefined, undefined)).toBeNull();
		expect(backward.body.children).toHaveLength(2);
		expectParseConverged(backward.doc);
	});
});

// Non-vacuity: the refusal must not have swallowed the ordinary join the same doors serve.
describe('a join whose bytes stay one block still merges', () => {
	it('joins two paragraphs forward and backward', () => {
		const forward = parse('alpha\n\nbeta\n');
		expect(mergeWithNext(forward, 0, undefined, undefined).change.op).toBe('replace');
		expect(serialize(forward)).toBe('alphabeta\n');

		const backward = parse('alpha\n\nbeta\n');
		expect(mergeIntoPrevDeepLeaf(backward, 1, undefined, undefined, undefined)).not.toBeNull();
		expect(serialize(backward)).toBe('alphabeta\n');
	});
});
