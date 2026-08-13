// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { performCrossBlockDeleteSync } from '$lib/selection/cross-block/ops';
import { splitNode } from '$lib/tree-operations/node-ops';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { asDocPath } from '$lib/selection/path-math';

// The ceremony settles every splice against the pre-mutate children it still holds
// (`tree-operations/node-ops.settleSeparator`). Two contracts the wiring owes.
// Miss-analysis: the settle lived at each splice site, so no case ever asked what a SECOND
// settle over the same window does, nor whether a probe reading post-splice state could still
// see was-blank. Both only became askable when the rule moved into the seam.

function makeTop(source: string | ReturnType<typeof parse>) {
	const harness = makeEditorActionsDeps(typeof source === 'string' ? parse(source) : source);
	const controller = createUndoController(harness.deps);
	return { ...harness, controller, actions: createBlockEditActions(harness.deps, controller) };
}

describe('the ceremony settle over a window its mutate already settled', () => {
	it('leaves an emptied block alone rather than settling its run twice', async () => {
		const h = makeTop('alpha\n\nx\n\ndelta\n');

		await h.actions.updateBlockContent(1, '\n');

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});

	// A multi-block fill returns a `replace` window covering the filled slot, so the funnel sees
	// the same transition `updateNodeContent` just answered for.
	it('leaves a multi-block fill of a blank slot alone', async () => {
		const h = makeTop('alpha\n\n\ndelta\n');

		await h.actions.updateBlockContent(1, 'p\n\nq\n');

		expect(serialize(h.deps.doc)).toBe('alpha\n\np\n\nq\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});
});

// A cross-block delete crosses BOTH funnel entries in one commit: `rangeDelete` splices through
// the path-addressed door inside `mutate`, then the ceremony settles the scope's change over the
// same window. The truncated start block is a new node, so the survivor filter reads the original
// as removed — and a blank one takes the restore branch on top of what the splice already settled.
describe('a delete that crosses both funnel entries in one commit', () => {
	function deleteAcross(
		source: string,
		anchor: number[],
		focus: number[],
		offsets: [number, number]
	) {
		const harness = makeEditorActionsDeps(parse(source).children);
		const controller = createUndoController(harness.deps);
		// Container scopes resolve through the registry, so a nested endpoint needs its state.
		harness.deps.doc.children.forEach((node, i) => {
			if (node.children) {
				registerBlockListState(
					node,
					makeBlockListState(() => harness.deps.doc.children[i])
				);
			}
		});
		harness.deps.selectionState.enterCrossBlock(
			{ path: anchor, offset: offsets[0] },
			{ path: focus, offset: offsets[1] }
		);
		performCrossBlockDeleteSync({
			selection: harness.deps.selectionState,
			getDoc: () => harness.deps.doc,
			getBlockElByPath: () => null,
			revealPath: harness.deps.revealPath,
			controller,
			pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0),
			grammar: undefined,
			getPresentationMode: undefined,
			linkRef: undefined
		});
		return harness;
	}

	it('settles once when the range starts in a load-shaped blank block', () => {
		const h = deleteAcross('alpha\n\n\ndelta\n\nomega\n', [1], [2], [0, 2]);

		expect(serialize(h.deps.doc)).toBe('alpha\n\nlta\n\nomega\n');
		expectParseConverged(h.deps.doc);
	});

	// The split shape: the blank slot holds no line and its follower holds the run's one.
	it('settles once when the range starts in a split-shaped blank block', () => {
		const split = parse('alpha\n\ndelta\n\nomega\n');
		splitNode(split, 0, 5, undefined, undefined);
		const h = deleteAcross(serialize(split), [1], [2], [0, 2]);

		expectParseConverged(h.deps.doc);
		expect(serialize(h.deps.doc)).not.toContain('\n\n\n');
	});

	it('settles once across a container scope', () => {
		const h = deleteAcross('> alpha\n>\n>\n> delta\n\nomega\n', [0, 1], [0, 2], [0, 2]);

		expect(serialize(h.deps.doc)).toBe('> alpha\n>\n> lta\n\nomega\n');
		expectParseConverged(h.deps.doc);
	});
});

// The gap-caret Enter below the last block of a suffix-folded document: the mint is blank, so
// the settle materializes the folded line into a block, and the published change must report
// that growth or `applyStructuralChangeToIdsRefs` under-counts. Bytes stay green through the
// desync, hence the assertions on the parallel arrays.
describe('an insert whose settle materializes the folded tail line', () => {
	// Miss-analysis: `makeEditorActionsDeps` hardcoded `suffix: ''`, so a top-level fixture built
	// the natural way could not hold a folded trailing line — unreachable, not merely untested.
	it('keeps blockIds and refs in step with the tree', async () => {
		const h = makeTop(parse('alpha\n\n'));
		expect(h.deps.doc.suffix).toBe('\n');

		await h.actions.insertParagraph(1, '');

		// Three blocks: the mint is blank, so the folded line can no longer stay folded — it is
		// a block the reload would read anyway (GH #129's rule, reached through an insert).
		expect(serialize(h.deps.doc)).toBe('alpha\n\n\n\n');
		expect(h.deps.doc.children).toHaveLength(3);
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expect(h.getBlockRefs()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});
});

describe('the ceremony settle reads was-blank off the pre-mutate children', () => {
	it('hands both ends back the line a blank slot was holding for them', async () => {
		const h = makeTop('alpha\n\n\ndelta\n');

		await h.controller.commitStructural({
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: (children) => {
				children.splice(1, 1, ...parse('X\n').children);
				return { op: 'replace', at: 1, count: 1, newCount: 1 };
			}
		});

		expect(serialize(h.deps.doc)).toBe('alpha\n\nX\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});
});
