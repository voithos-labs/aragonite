import { describe, it, expect } from 'vitest';
import type { Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeIntoPrevDeepLeaf, mergeWithNext } from '$lib/tree-operations';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';
import { createSharingState } from '$lib/tree-operations/sharing';
import type { BodyParent } from '$lib/tree-operations/node-primitives';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';
import { documentLineEnding } from '$lib/core/lines';

// GH #166. Miss-analysis: G2.13's gesture lane drove split, delete and content commits but no
// merge, so no check ever read a merged tree back; the forward merge's own dev warn was the only
// witness of the dropped line, and the deep-leaf merge had none at all.

/** A heading whose join with the paragraph below reads as two blocks: `# htext` then `more`. */
const HEADING_OVER_TWO_LINES = '# h\ntext\nmore\n';
const QUOTED = '> # h\n> text\n> more\n';

/** The blockquote's body as a parent the primitives write, plus the doc holding it. */
function quotedBody(): { doc: Document; body: BodyParent } {
	const doc = parse(QUOTED);
	const quote = doc.children[0];
	return {
		doc,
		body: {
			children: quote.children!,
			owner: quote,
			lineEnding: documentLineEnding(doc)
		}
	};
}

describe('a join whose bytes read as several blocks is refused, not truncated', () => {
	it('declines the forward join rather than dropping every block past the first', () => {
		const doc = parse(HEADING_OVER_TWO_LINES);

		const { change } = mergeWithNext(doc, 0, fixtureReading(), undefined);

		expect(change).toEqual({ op: 'noop' });
		expect(serialize(doc)).toBe(HEADING_OVER_TWO_LINES);
		expect(doc.children).toHaveLength(2);
	});

	it('declines the backward join rather than writing a leaf its own reload disagrees with', () => {
		const doc = parse(HEADING_OVER_TWO_LINES);

		expect(mergeIntoPrevDeepLeaf(doc, 1, undefined, fixtureReading())).toBeNull();

		expect(serialize(doc)).toBe(HEADING_OVER_TWO_LINES);
		expect(doc.children).toHaveLength(2);
		expectParseConverged(doc);
	});

	// Bytes prove nothing here: a body merge writes the quote's children and never rebuilds the
	// container's own raw, so `serialize` reads back the source whatever the merge did. What can
	// fail is the change descriptor and the reload, which is what a truncation would break.
	it('declines both directions inside a blockquote body', () => {
		const forward = quotedBody();
		expect(mergeWithNext(forward.body, 0, fixtureReading(), undefined).change).toEqual({
			op: 'noop'
		});
		expect(forward.body.children).toHaveLength(2);
		expectParseConverged(forward.doc);

		const backward = quotedBody();
		expect(mergeIntoPrevDeepLeaf(backward.body, 1, undefined, fixtureReading())).toBeNull();
		expect(backward.body.children).toHaveLength(2);
		expectParseConverged(backward.doc);
	});
});

// Non-vacuity: the refusal must not have swallowed the ordinary join the same merges serve.
describe('a join whose bytes stay one block still merges', () => {
	it('joins two paragraphs forward and backward', () => {
		const forward = parse('alpha\n\nbeta\n');
		expect(mergeWithNext(forward, 0, fixtureReading(), undefined).change.op).toBe('replace');
		expect(serialize(forward)).toBe('alphabeta\n');

		const backward = parse('alpha\n\nbeta\n');
		expect(mergeIntoPrevDeepLeaf(backward, 1, undefined, fixtureReading())).not.toBeNull();
		expect(serialize(backward)).toBe('alphabeta\n');
	});
});

// Miss-analysis: every refusal test ran without a sharing state, so a join that copied its
// ancestors before deciding to refuse left the undo snapshot's nodes swapped out unnoticed.
describe('a refused join copies nothing', () => {
	const snapshotSharing = () => {
		const sharing = createSharingState();
		sharing.markSnapshotTaken();
		return sharing;
	};

	it('the deep Backspace join leaves the container it refused to write into as it was', () => {
		const doc = parse('> # h\n\ntext\nmore\n');
		const quote = doc.children[0];
		const heading = quote.children![0];

		expect(mergeIntoPrevDeepLeaf(doc, 1, snapshotSharing(), fixtureReading())).toBeNull();

		expect(doc.children[0]).toBe(quote);
		expect(quote.children![0]).toBe(heading);
	});

	it('the list-item join leaves the target item as it was', () => {
		const doc = parse('- # h\n- text\n  more\n');
		const list = doc.children[0];
		const target = list.children![0];

		const result = mergeListItemIntoPrevious(
			list,
			list.children!.slice(),
			1,
			snapshotSharing(),
			fixtureReading()
		);

		expect(result).toBeNull();
		expect(list.children![0]).toBe(target);
	});
});
