import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/node-ops';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// GH #21: a mutation can invalidate a join that was already correct — a demoted heading stops
// interrupting the paragraph under it, a reorder pulls an interrupter out from between two — and
// the siblings left behind reload as ONE block. The seam absorb settles each to the reading the
// reload gives it, byte-identical.
// Miss-analysis: the seam question was pinned at the delete door alone, never asked as a
// sibling-path parity question of the other doors that disturb a join.

const sharing = () => createSharingState();

describe('a kind demotion settles the join below (GH #21)', () => {
	it('absorbs the neighbour a typed character turned into a continuation', () => {
		const doc = parse('# h\nb\n');

		const change = updateNodeContent(doc, 0, 'x# h\n');

		expect(serialize(doc)).toBe('x# h\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['x# h\nb\n']);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
	});

	// The other side of the same `updateNodeContent` arm: the marker deleted rather than pushed off.
	it('absorbs when the marker is deleted instead', () => {
		const doc = parse('# h\nb\n');

		updateNodeContent(doc, 0, ' h\n');

		expect(serialize(doc)).toBe(' h\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual([' h\nb\n']);
	});

	// Only a TIGHT join is invalidated; a separated neighbour still reloads as its own block, so
	// the absorb declines rather than eating the line between them.
	it('leaves a separated neighbour standing', () => {
		const doc = parse('# h\n\nb\n');

		updateNodeContent(doc, 0, 'x# h\n');

		expect(serialize(doc)).toBe('x# h\n\nb\n');
		expect(doc.children.map((c) => c.raw)).toEqual(['x# h\n', 'b\n']);
		expect(describeConvergence(doc)).toBeNull();
	});

	// A multi-block write puts a MINTED block against the follower, so the seam owed is the one
	// at the last block written, not at the slot the gesture named.
	it('asks at the last block a multi-block write minted', () => {
		const doc = parse('# h\nb\n');

		const change = updateNodeContent(doc, 0, '---\nx\n');

		expect(serialize(doc)).toBe('---\nx\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['thematicBreak', '---\n'],
			['paragraph', 'x\nb\n']
		]);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 2, idMap: { 0: 0 } });
	});
});

describe('a reorder settles the joins the move disturbed (GH #21)', () => {
	it('folds the pair an interrupter moved out from between', () => {
		const doc = parse('a\n# h\nb\n');

		const result = reorderChildrenWithTrivia(doc.children, 1, 2, sharing());

		expect(serialize(doc)).toBe('a\nb\n# h\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['a\nb\n', '# h\n']);
		expect(result.change).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 2,
			idMap: { 0: 0 }
		});
		// The moved block outlived a fold ABOVE it, so the caret lands one slot short of `to`.
		expect(result.landing).toBe(1);
	});

	// The window's lower edge: the same move upward leaves the pair adjacent BELOW it.
	it('folds the pair the move left below the window', () => {
		const doc = parse('a\n# h\nb\n');

		const result = reorderChildrenWithTrivia(doc.children, 1, 0, sharing());

		expect(serialize(doc)).toBe('# h\na\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['# h\n', 'a\nb\n']);
		expect(result.landing).toBe(0);
	});

	it('stays a plain permutation where every join holds', () => {
		const doc = parse('a\n\nb\n\nc\n');

		const result = reorderChildrenWithTrivia(doc.children, 0, 2, sharing());

		expect(serialize(doc)).toBe('b\n\nc\n\na\n');
		expect(result.change).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 3,
			idMap: { 0: 1, 1: 2, 2: 0 }
		});
		expect(result.landing).toBe(2);
		expect(describeConvergence(doc)).toBeNull();
	});

	// A structured container's children have no standalone reading — two items' joined bytes read
	// as a nested list, which is the parent's kind — so the seam is not askable inside one.
	it('never folds a list into its own items', () => {
		const doc = parse('- a\n- # h\n- b\n');
		const items = doc.children[0].children!;

		const result = reorderChildrenWithTrivia(items, 1, 2, sharing());

		expect(items.map((c) => c.raw)).toEqual(['- a\n', '- b\n', '- # h\n']);
		expect(result.landing).toBe(2);
	});
});
