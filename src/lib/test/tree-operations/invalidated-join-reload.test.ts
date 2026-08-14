import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { absorbWindowSeams, updateNodeContent } from '$lib/tree-operations/node-ops';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { rebuildContainerRaw } from '$lib/schema/container-raw';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import type { CstNode } from '$lib/core/nodes';

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

		const { change } = updateNodeContent(doc, 0, 'x# h\n');

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

	// The content door exists at two levels, and the container one writes marker-stripped body
	// bytes — a different reading path than the document's, so it owes its own pin.
	it('absorbs inside a container body too', () => {
		const doc = parse('> # h\n> b\n');
		const quote = doc.children[0];

		const { change } = updateNodeContent(
			{ children: quote.children!, ownerKind: quote.kind, owner: quote },
			0,
			'x# h\n'
		);
		rebuildContainerRaw(quote);

		expect(serialize(doc)).toBe('> x# h\n> b\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(quote.children!.map((c) => c.raw)).toEqual(['x# h\nb\n']);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
	});

	// A multi-block write puts a MINTED block against the follower, so the seam owed is the one
	// at the last block written, not at the slot the gesture named.
	it('asks at the last block a multi-block write minted', () => {
		const doc = parse('# h\nb\n');

		const { change } = updateNodeContent(doc, 0, '---\nx\n');

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

// No single reorder reaches two DISJOINT folds — a fold's own cascade collapses adjacent ones into
// one anchor, and positional trivia keeps a moved block's new slot separated — so the union
// arithmetic is pinned at the helper's own contract instead.
describe('absorbWindowSeams reports disjoint folds as one window', () => {
	it('unions them and carries the tracked index through both', () => {
		const block = (source: string): CstNode => parse(source, { scope: 'fragment' }).children[0];
		const children = ['a\n', 'b\n', '# h\n', 'c\n', 'd\n'].map(block);

		const settled = absorbWindowSeams({ children }, 0, 5, 4, { op: 'noop' });

		expect(children.map((c) => c.raw)).toEqual(['a\nb\n', '# h\n', 'c\nd\n']);
		expect(settled.change).toEqual({
			op: 'replace',
			at: 0,
			count: 5,
			newCount: 3,
			idMap: { 0: 0 }
		});
		expect(settled.landing).toBe(2);
	});
});

// A mutation INSIDE a container changes whether the container interrupts, and the join it
// invalidates is in the GRANDPARENT's children, which the container's own commit never splices
// (GH #176). The ancestry rebuild asks the seam at the container's slot on its way out.
// Miss-analysis: the fuzzer's lanes each mutate a block and ask about its siblings; none mutates
// inside a container and asks the container's own slot above.
describe('a nested delete can stop an ordered list interrupting (GH #176)', () => {
	it('folds the list into the paragraph it stopped interrupting', async () => {
		const h = makeNestedHarness('a\n1. x\n2. y\n', { index: 1, listOverrides: true });

		await h.bundle.blockEdit.deleteBlock(0);

		expect(serialize(h.deps.doc)).toBe('a\n2. y\n');
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph']);
		expect(describeConvergence(h.deps.doc)).toBeNull();
		// The parallel arrays are the grandparent's, which no commit descriptor covers.
		expect(h.deps.blockIds).toHaveLength(1);
		expect(h.deps.blockRefs).toHaveLength(1);
	});

	// The other side of the gate: a delete that leaves the list still interrupting settles
	// nothing, so the paragraph above keeps its own slot.
	it('leaves a list that still starts at 1 standing', async () => {
		const h = makeNestedHarness('a\n1. x\n2. y\n', { index: 1, listOverrides: true });

		await h.bundle.blockEdit.deleteBlock(1);

		expect(serialize(h.deps.doc)).toBe('a\n1. x\n');
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'list']);
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.deps.blockIds).toHaveLength(2);
	});
});
