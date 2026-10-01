// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { replaceRange } from '$lib/selection/cross-block/range-replace';
import { rangeContext } from '../../selection/cross-block/range-context';
import { splitNode } from '$lib/tree-operations/node-ops';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeTopHarness
} from '$lib/test/harness/editor-actions';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { asDocPath } from '$lib/selection/path-math';
import { fixtureReading } from '../../harness/fixture-grammar';
import { createSharingState } from '$lib/tree-operations/sharing';

// The commit's blank-line fix-up must change nothing over a range its mutate already fixed up.
// Miss-analysis: the fix-up lived at each splice site, so no case ran a second one over one range.

describe('the commit sequence settle over a window its mutate already settled', () => {
	it('leaves an emptied block alone rather than settling its run twice', async () => {
		const h = makeTopHarness('alpha\n\nx\n\ndelta\n');

		await h.actions.updateBlockContent(1, '\n', 'authored', 0);

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});

	// A multi-block fill returns a `replace` range covering the filled index, so the commit's
	// fix-up sees the same transition `updateNodeContent` just handled.
	it('leaves a multi-block fill of a blank slot alone', async () => {
		const h = makeTopHarness('alpha\n\n\ndelta\n');

		await h.actions.updateBlockContent(1, 'p\n\nq\n', 'authored', 0);

		expect(serialize(h.deps.doc)).toBe('alpha\n\np\n\nq\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});
});

// A cross-block delete splices inside `mutate`, then the commit fixes up the same range; the
// truncated start block is a new node, so a blank one must not be fixed up a second time.
describe('a delete that crosses both shared entries in one commit', () => {
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
		// A composition's removal, which commits before the replace's first await.
		void replaceRange(rangeContext(harness.deps, controller, fixtureReading()), {
			kind: 'composition',
			leafPath: anchor
		});
		return harness;
	}

	it('settles once when the range starts in a load-shaped blank block', () => {
		const h = deleteAcross('alpha\n\n\ndelta\n\nomega\n', [1], [2], [0, 2]);

		expect(serialize(h.deps.doc)).toBe('alpha\n\nlta\n\nomega\n');
		expectParseConverged(h.deps.doc);
	});

	// The split shape: the blank block holds no line and its follower holds the run's one.
	it('settles once when the range starts in a split-shaped blank block', () => {
		const split = parse('alpha\n\ndelta\n\nomega\n');
		splitNode(split, 0, 5, createSharingState(), fixtureReading());
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

// The new paragraph is blank, so the fix-up turns the suffix's trailing blank line into a block,
// and the reported change must count it or the id and ref arrays fall one short.
describe('an insert whose settle materializes the folded tail line', () => {
	// Miss-analysis: `makeEditorActionsDeps` hardcoded `suffix: ''`, so no fixture had a tail line.
	it('keeps blockIds and refs in step with the tree', async () => {
		const h = makeTopHarness(parse('alpha\n\n'));
		expect(h.deps.doc.suffix).toBe('\n');

		await h.actions.insertParagraph(1, '');

		// Three blocks: the new paragraph is blank, so the suffix line cannot stay in the suffix;
		// it is a block a reload would read anyway.
		expect(serialize(h.deps.doc)).toBe('alpha\n\n\n\n');
		expect(h.deps.doc.children).toHaveLength(3);
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expect(h.getBlockRefs()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});

	// Miss-analysis (GH #168): no case deleted a block with a trailing blank line in the suffix.
	it('keeps them in step when a delete leaves the tail blank against the folded line', async () => {
		const h = makeTopHarness(parse('alpha\n\n\nbeta\n\n'));
		expect(h.deps.doc.suffix).toBe('\n');

		await h.actions.deleteBlock(2, 'keyless');

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\n\n');
		expect(h.deps.doc.children).toHaveLength(3);
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);

		// The following commit is where an unreported new block becomes permanent: the id and
		// ref arrays are one short before it and stay one short after.
		await h.actions.deleteBlock(0, 'keyless');

		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expect(h.getBlockRefs()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});
});

describe('the commit sequence settle reads was-blank off the pre-mutate children', () => {
	it('hands both ends back the line a blank slot was holding for them', async () => {
		const h = makeTopHarness('alpha\n\n\ndelta\n');

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
