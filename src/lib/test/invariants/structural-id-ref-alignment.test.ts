import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import type { NestedActionsBundle } from '$lib/editor-actions/nested/nested-actions';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { assignChildIdsDeep } from '$lib/block-id';
import { buildPastedReplacement } from '$lib/tree-operations';
import {
	stubBlockComponent,
	makeEditorActionsDeps,
	makeNestedHarness,
	makeNode
} from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { BlockComponent } from '$lib/block-component';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import { replaceRefs } from '$lib/reactivity/publish-ref.svelte';
import type { CstNode } from '$lib/core/nodes';
import { defaultGrammarView } from '$lib/schema/block-openers';

/**
 * G2.8: after every structural op, `children`, the keyed-id array and the ref array stay the same
 * length and line up index for index. If they do not, Svelte destroys and recreates the wrong
 * component, dropping IME state or stranding focus. The ops drive the real action bundles, so
 * `applyStructuralChangeToIdsRefs` is what is under test. Reorder is the shape most likely to
 * break the alignment, because every moved position reuses an existing id instead of creating one.
 */

// ── Top-level alignment ──────────────────────────────────────────────────────

interface TopHarness {
	doc: ReturnType<typeof makeEditorActionsDeps>['doc'];
	actions: ReturnType<typeof createBlockEditActions>;
	reorder: ReturnType<typeof createReorderAction>;
	ids: () => string[];
	refs: () => (BlockComponent | undefined)[];
}

const makeTop = (raws: string[]): TopHarness => makeTopFrom(raws.join('\n'));

/**
 * Blank-separated like a parsed document, because two paragraphs with no blank line between them
 * are a lazy continuation that the fix-up merges the way a reload would (GH #61), plus the
 * trailing blank line the parse puts into `suffix`. A children-only fixture cannot hold one, which
 * left every branch that spends it unreachable from here (GH #168).
 */
function makeTopFrom(source: string): TopHarness {
	const { deps, doc, getBlockIds, getBlockRefs } = makeEditorActionsDeps(parse(source + '\n'));
	const controller = createUndoController(deps);
	const actions = createBlockEditActions(deps, controller);
	const reorder = createReorderAction(deps, controller);
	return { doc, actions, reorder, ids: getBlockIds, refs: getBlockRefs };
}

function assertAligned(h: {
	doc: { children: CstNode[] };
	ids: () => string[];
	refs: () => unknown[];
}) {
	const n = h.doc.children.length;
	expect(h.ids(), 'id array length').toHaveLength(n);
	expect(h.refs(), 'ref array length').toHaveLength(n);
	expect(new Set(h.ids()).size, 'ids unique').toBe(n);
}

describe('G2.8 top-level id↔ref↔children alignment', () => {
	it('split keeps arrays aligned and pins the original id to the first half', async () => {
		const h = makeTop(['hello world\n', 'second\n']);
		const [id0, id1] = h.ids();
		const ref0 = h.refs()[0];

		await h.actions.splitBlock(0, 5);

		assertAligned(h);
		expect(h.doc.children).toHaveLength(3);
		// Split is a replace with idMap {0:0}, so the first half inherits id0 + ref0.
		expect(h.ids()[0]).toBe(id0);
		expect(h.refs()[0]).toBe(ref0);
		expect(h.ids()[1]).not.toBe(id0);
		expect(h.ids()[1]).not.toBe(id1);
		expect(h.ids()[2]).toBe(id1);
	});

	it('merge keeps arrays aligned and preserves the survivor id', async () => {
		const h = makeTop(['aaa\n', 'bbb\n', 'ccc\n']);
		const [id0, id1, id2] = h.ids();

		await h.actions.mergeWithNext(0);

		assertAligned(h);
		expect(h.doc.children).toHaveLength(2);
		expect(h.ids()[0]).toBe(id0);
		expect(h.ids()[1]).toBe(id2);
		expect(h.ids()).not.toContain(id1);
	});

	it('delete keeps arrays aligned and drops the right slot', async () => {
		const h = makeTop(['aaa\n', 'bbb\n', 'ccc\n']);
		const [id0, , id2] = h.ids();

		await h.actions.deleteBlock(1);

		assertAligned(h);
		expect(h.ids()).toEqual([id0, id2]);
	});

	it('multi-block replace (paste live path) keeps arrays aligned and pins the host id to the first piece', async () => {
		const h = makeTop(['hello\n', 'tail\n']);
		const [id0, id1] = h.ids();

		await h.actions.replaceBlock(0, [
			makeNode('paragraph', 'x\n'),
			{ ...makeNode('paragraph', 'y\n'), leadingTrivia: '\n' }
		]);

		assertAligned(h);
		expect(h.doc.children.length).toBeGreaterThan(2);
		expect(h.ids()[0]).toBe(id0);
		expect(h.ids().at(-1)).toBe(id1);
	});

	it('reorder keeps arrays aligned and carries moved ids via idMap', async () => {
		const h = makeTop(['aaa\n', 'bbb\n', 'ccc\n']);
		const [id0, id1, id2] = h.ids();

		await h.reorder.nudgeReorderUnit([0], 1);

		assertAligned(h);
		expect(h.ids()).toEqual([id1, id0, id2]);
	});

	// GH #168: the fix-up turns the document's trailing line into a block when a delete leaves the
	// tail blank, and a change that does not report that growth costs one id on the next commit.
	it('a delete whose settle creates the folded tail line keeps arrays aligned', async () => {
		const h = makeTopFrom('alpha\n\n\nbeta\n');

		await h.actions.deleteBlock(2);
		assertAligned(h);
		expect(h.doc.children).toHaveLength(3);

		await h.actions.deleteBlock(0);
		assertAligned(h);
	});

	it('round-trip stays byte-stable across a sequence of ops', async () => {
		const h = makeTop(['one\n', 'two\n', 'three\n']);
		const stable = () => {
			const live = serialize(h.doc);
			expect(serialize(parse(live))).toBe(live);
		};

		await h.actions.splitBlock(0, 1);
		stable();
		assertAligned(h);
		await h.actions.mergeWithNext(0);
		stable();
		assertAligned(h);
		await h.actions.deleteBlock(0);
		stable();
		assertAligned(h);
	});
});

// ── Container alignment ──────────────────────────────────────────────────────

interface ContainerHarness {
	doc: ReturnType<typeof makeEditorActionsDeps>['doc'];
	/** Live container: commits replace the node object (copy before write). */
	node: () => CstNode;
	state: BlockListState;
	bundle: NestedActionsBundle;
	reorder: ReturnType<typeof createReorderAction>;
}

// Pre-fill innerBlockRefs to mirror a mounted container: the `{#each}` that fills them never runs
// under node, so without this the alignment check would chase a harness artifact.
function makeContainer(source: string): ContainerHarness {
	const initial = parse(source).children[0];
	expect(initial.children, 'container has children').toBeTruthy();

	const { deps, controller, state, bundle, getNode: node } = makeNestedHarness([initial]);
	const reorder = createReorderAction(deps, controller);
	replaceRefs(
		state.innerBlockRefs,
		(initial.children ?? []).map(() => stubBlockComponent())
	);

	return { doc: deps.doc, node, state, bundle, reorder };
}

function assertContainerAligned(h: ContainerHarness) {
	const n = h.node().children?.length ?? 0;
	expect(h.state.innerBlockIds, 'inner id length').toHaveLength(n);
	expect(h.state.innerBlockRefs, 'inner ref length').toHaveLength(n);
	expect(new Set(h.state.innerBlockIds).size, 'inner ids unique').toBe(n);
}

// Prose children so the pairwise merge is eligible: a list of items would not reach the
// in-container merge path, since one list item does not merge directly into another.
const BQ_THREE = '> aaaa\n>\n> bbbb\n>\n> cccc\n';
const BQ_TWO = '> aaaa\n>\n> bbbb\n';

describe('G2.8 container id↔ref↔children alignment', () => {
	it('inner split keeps arrays aligned and pins the original id to the first half', async () => {
		const h = makeContainer(BQ_TWO);
		const [id0, id1] = h.state.innerBlockIds;
		const ref0 = h.state.innerBlockRefs[0];

		await h.bundle.blockEdit.splitBlock(0, 2);

		assertContainerAligned(h);
		expect(h.node().children).toHaveLength(3);
		expect(h.state.innerBlockIds[0]).toBe(id0);
		expect(h.state.innerBlockRefs[0]).toBe(ref0);
		expect(h.state.innerBlockIds[1]).not.toBe(id0);
		expect(h.state.innerBlockIds[2]).toBe(id1);
	});

	it('inner merge keeps arrays aligned and preserves the survivor id', async () => {
		const h = makeContainer(BQ_THREE);
		const [id0, id1, id2] = h.state.innerBlockIds;

		await h.bundle.blockEdit.mergeWithNext(0);

		assertContainerAligned(h);
		expect(h.node().children).toHaveLength(2);
		expect(h.state.innerBlockIds[0]).toBe(id0);
		expect(h.state.innerBlockIds[1]).toBe(id2);
		expect(h.state.innerBlockIds).not.toContain(id1);
	});

	it('inner delete keeps arrays aligned and drops the right slot', async () => {
		const h = makeContainer(BQ_THREE);
		const [id0, , id2] = h.state.innerBlockIds;
		const ref0 = h.state.innerBlockRefs[0];

		await h.bundle.blockEdit.deleteBlock(1);

		assertContainerAligned(h);
		expect(h.state.innerBlockIds).toEqual([id0, id2]);
		expect(h.state.innerBlockRefs[0]).toBe(ref0);
	});

	it('inner replace (paste live path) keeps arrays aligned and pins the host id to the first piece', async () => {
		const h = makeContainer(BQ_TWO);
		const [id0, id1] = h.state.innerBlockIds;

		await h.bundle.blockEdit.replaceBlock(0, [
			makeNode('paragraph', 'x\n'),
			makeNode('paragraph', 'y\n')
		]);

		assertContainerAligned(h);
		expect(h.state.innerBlockIds[0]).toBe(id0);
		expect(h.state.innerBlockIds).toContain(id1);
	});

	it('inner reorder keeps arrays aligned and carries moved ids via idMap', async () => {
		const h = makeContainer(BQ_THREE);
		const [id0, id1, id2] = h.state.innerBlockIds;

		await h.reorder.nudgeReorderUnit([0, 0], 1);

		assertContainerAligned(h);
		expect(h.state.innerBlockIds).toEqual([id1, id0, id2]);
	});

	it('round-trip stays byte-stable and serialized raw tracks the mutated children', async () => {
		const h = makeContainer(BQ_THREE);
		// A byte round-trip alone passes on a stale container raw, because valid but out-of-date
		// GFM still round-trips, so the comparison against a fresh parse is what catches it.
		const stable = () => {
			expectParseConverged(h.doc);
			const live = serialize(h.doc);
			expect(serialize(parse(live))).toBe(live);
		};

		// Without rebuildRaw the container's stale raw still carries "aaaa", so the
		// round-trip + content pair below is non-vacuous.
		await h.bundle.blockEdit.deleteBlock(0);
		stable();
		assertContainerAligned(h);
		expect(serialize(h.doc)).not.toContain('aaaa');
		expect(serialize(h.doc)).toContain('bbbb');

		await h.bundle.blockEdit.mergeWithNext(0);
		stable();
		assertContainerAligned(h);
	});
});

// ── Deep childIds backfill on reparse-into-container (G2.8 / #4 class) ─────────

/**
 * A freshly parsed subtree spliced under a component id that is kept carries no `childIds`, so
 * undefined keys reach Svelte if the reused container renders before the re-init effect, which
 * crashes on duplicate keys once a nested container holds two or more children. The fill-in lives
 * in `stampStructuralChange`, the one function every new-node op routes through, so the check
 * covers every path; the fixture nests two such containers to meet the crash condition.
 */
const NESTED_LIST = '1. First.\n\n   Continuation.\n2. Second:\n   - x\n   - y\n';

function assertDeepChildIdsAligned(children: CstNode[]) {
	const violations: { path: number[]; childrenLen: number; idsLen: number }[] = [];
	const walk = (node: CstNode, path: number[]) => {
		if (node.children) {
			const idsLen = node.childIds?.length ?? -1;
			if (idsLen !== node.children.length)
				violations.push({ path, childrenLen: node.children.length, idsLen });
			node.children.forEach((c, i) => walk(c, [...path, i]));
		}
	};
	children.forEach((c, i) => walk(c, [i]));
	expect(violations, `containers with childIds desynced from children`).toEqual([]);
}

describe('G2.8 deep childIds backfill on reparse-into-container (#4 class)', () => {
	it('replaceBlock with a reparsed nested list initializes childIds at every level', async () => {
		const h = makeTop(['placeholder\n']);
		const nested = parse(NESTED_LIST).children;
		expect(nested[0].kind).toBe('list'); // genuinely a container, or the test is vacuous

		await h.actions.replaceBlock(0, nested);

		assertAligned(h);
		assertDeepChildIdsAligned(h.doc.children);
	});

	it('structural paste (folded replacement) of a reparsed nested list initializes childIds deeply', async () => {
		const h = makeTop(['head\n', 'tail\n']);
		const nested = parse(NESTED_LIST).children;

		// The live paste path merges the clipboard and splices it through replaceBlock
		// (defaultStructuralHook → buildPastedReplacement), a second route to the fill-in.
		const { nodes: replacement } = buildPastedReplacement(
			h.doc.children[0],
			4,
			nested,
			defaultGrammarView
		);
		await h.actions.replaceBlock(0, replacement);

		assertAligned(h);
		assertDeepChildIdsAligned(h.doc.children);
	});

	// merge-prev is the one path adding nodes that skips the fill-in: it creates no container, so
	// a change that made it reparse into one would break the alignment here.
	it('mergeWithPrevious into a container leaf keeps deep childIds aligned', async () => {
		const list = parse(NESTED_LIST).children[0];
		expect(list.kind).toBe('list');
		assignChildIdsDeep(list); // a mounted/committed container already carries childIds
		const { deps, doc } = makeEditorActionsDeps([list, makeNode('paragraph', 'tail\n')]);
		const actions = createBlockEditActions(deps, createUndoController(deps));

		// container + prose is merge-eligible: the paragraph merges into the list's deepest
		// prose leaf, with no parse().
		await actions.mergeWithPrevious(1);

		expect(doc.children).toHaveLength(1);
		assertDeepChildIdsAligned(doc.children);
	});
});
