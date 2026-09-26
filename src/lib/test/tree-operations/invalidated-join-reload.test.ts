import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { absorbWindowSeams } from '$lib/tree-operations/settle';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { ensureUnsharedPath } from '$lib/tree-operations/unshare';
import { rebuildUnsharedChain, type AncestrySeamFold } from '$lib/tree-operations/chain-rebuild';
import { rebuildContainerRaw } from '$lib/schema/container-raw';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import type { CstNode } from '$lib/core/nodes';
import { defaultGrammarView } from '$lib/schema/block-openers';

// GH #21: a mutation can break a join that was already correct (a demoted heading stops
// interrupting the paragraph under it, a reorder pulls an interrupter out from between two), and
// the siblings left behind reload as one block. The neighbour merge brings each to the reading
// the reload gives it, byte-identical.
// Miss-analysis: the join question was pinned at the delete alone, never asked as a sibling-path
// parity question of the other mutations that disturb a join.

const sharing = () => createSharingState();

describe('a kind demotion settles the join below (GH #21)', () => {
	it('absorbs the neighbour a typed character turned into a continuation', () => {
		const doc = parse('# h\nb\n');

		const { change } = updateNodeContent(doc, 0, 'x# h\n', defaultGrammarView);

		expect(serialize(doc)).toBe('x# h\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['x# h\nb\n']);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
	});

	// The other side of the same `updateNodeContent` branch: the marker deleted rather than pushed off.
	it('absorbs when the marker is deleted instead', () => {
		const doc = parse('# h\nb\n');

		updateNodeContent(doc, 0, ' h\n', defaultGrammarView);

		expect(serialize(doc)).toBe(' h\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual([' h\nb\n']);
	});

	// Only a tight join is broken; a separated neighbour still reloads as its own block, so the
	// merge declines rather than eating the line between them.
	it('leaves a separated neighbour standing', () => {
		const doc = parse('# h\n\nb\n');

		updateNodeContent(doc, 0, 'x# h\n', defaultGrammarView);

		expect(serialize(doc)).toBe('x# h\n\nb\n');
		expect(doc.children.map((c) => c.raw)).toEqual(['x# h\n', 'b\n']);
		expect(describeConvergence(doc)).toBeNull();
	});

	// The content write exists at two levels, and the container one takes marker-stripped body
	// bytes, a different reading path than the document's, so it needs its own pin.
	it('absorbs inside a container body too', () => {
		const doc = parse('> # h\n> b\n');
		const quote = doc.children[0];

		const { change } = updateNodeContent(
			{ children: quote.children!, ownerKind: quote.kind, owner: quote, lineEnding: '\n' },
			0,
			'x# h\n',
			defaultGrammarView
		);
		rebuildContainerRaw(quote);

		expect(serialize(doc)).toBe('> x# h\n> b\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(quote.children!.map((c) => c.raw)).toEqual(['x# h\nb\n']);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
	});

	// A multi-block write puts a new block against the follower, so the join to ask is the one
	// at the last block written, not at the position the gesture named.
	it('asks at the last block a multi-block write created', () => {
		const doc = parse('# h\nb\n');

		const { change } = updateNodeContent(doc, 0, '---\nx\n', defaultGrammarView);

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

		const result = reorderChildrenWithTrivia(
			doc.children,
			1,
			2,
			sharing(),
			defaultGrammarView,
			'\n'
		);

		expect(serialize(doc)).toBe('a\nb\n# h\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['a\nb\n', '# h\n']);
		// The heading the merge did not eat keeps its position's identity: only the merged
		// window's blocks get new ids (GH #178).
		expect(result.change).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 2,
			idMap: { 0: 0, 1: 1 }
		});
		// The moved block outlived a merge above it, so the caret lands one position short of `to`.
		expect(result.landing).toBe(1);
	});

	// The window's lower edge: the same move upward leaves the pair adjacent below it.
	it('folds the pair the move left below the window', () => {
		const doc = parse('a\n# h\nb\n');

		const result = reorderChildrenWithTrivia(
			doc.children,
			1,
			0,
			sharing(),
			defaultGrammarView,
			'\n'
		);

		expect(serialize(doc)).toBe('# h\na\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['# h\n', 'a\nb\n']);
		expect(result.landing).toBe(0);
	});

	it('stays a plain permutation where every join holds', () => {
		const doc = parse('a\n\nb\n\nc\n');

		const result = reorderChildrenWithTrivia(
			doc.children,
			0,
			2,
			sharing(),
			defaultGrammarView,
			'\n'
		);

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

	// A structured container's children have no standalone reading (two items' joined bytes read
	// as a nested list, which is the parent's kind), so a join inside one cannot be asked.
	it('never folds a list into its own items', () => {
		const doc = parse('- a\n- # h\n- b\n');
		const items = doc.children[0].children!;

		const result = reorderChildrenWithTrivia(items, 1, 2, sharing(), defaultGrammarView, '\n');

		expect(items.map((c) => c.raw)).toEqual(['- a\n', '- b\n', '- # h\n']);
		expect(result.landing).toBe(2);
	});
});

// No single reorder reaches two disjoint merges (a merge continuing downward collapses adjacent
// ones into one, and positional separators keep a moved block's new position separated), so the
// union arithmetic is pinned at the helper's own contract instead.
describe('absorbWindowSeams reports disjoint folds as one window', () => {
	it('unions them and carries the tracked index through both', () => {
		const block = (source: string): CstNode => parse(source, { scope: 'fragment' }).children[0];
		const children = ['a\n', 'b\n', '# h\n', 'c\n', 'd\n'].map(block);

		const settled = absorbWindowSeams({ children }, 0, 5, 4, { op: 'noop' }, defaultGrammarView);

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

// A mutation inside a container changes whether the container interrupts, and the join it
// breaks is in the grandparent's children, which the container's own commit never splices
// (GH #176). The ancestor rebuild asks the join at the container's position on its way out.
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

	// The other side of the check: a delete that leaves the list still interrupting merges
	// nothing, so the paragraph above keeps its own position.
	it('leaves a list that still starts at 1 standing', async () => {
		const h = makeNestedHarness('a\n1. x\n2. y\n', { index: 1, listOverrides: true });

		await h.bundle.blockEdit.deleteBlock(1);

		expect(serialize(h.deps.doc)).toBe('a\n1. x\n');
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'list']);
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.deps.blockIds).toHaveLength(2);
	});

	// The lower half of the join check at the container's position, which the #176 pins left to
	// the opener side. The edit opens the container's own last block: a tight follower the quote
	// could not continue into becomes a lazy continuation, so the pair reloads as one. Only the
	// closer line moves, so this is the branch that reads the container's own bytes on every keystroke.
	it('folds the follower a body write let the container continue into', () => {
		const doc = parse('> a\n> # h\ntext\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['blockquote', 'paragraph']);
		const share = sharing();
		const chain = ensureUnsharedPath(doc, [0, 1], share);
		const quote = chain[0];

		updateNodeContent(
			{ children: quote.children!, ownerKind: quote.kind, owner: quote, lineEnding: '\n' },
			1,
			'h\n',
			defaultGrammarView
		);
		const folds: AncestrySeamFold[] = [];
		rebuildUnsharedChain(doc, chain, share, folds, defaultGrammarView);

		expect(serialize(doc)).toBe('> a\n> h\ntext\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['blockquote']);
		expect(folds).toHaveLength(1);
		expect(describeConvergence(doc)).toBeNull();
	});
});
