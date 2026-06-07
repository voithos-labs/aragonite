import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor/editor-actions/undo-controller';
import { createBlockEditActions } from '$lib/editor/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor/editor-actions/nested-actions';
import { createBlockListState } from '$lib/editor/reactivity/block-list-state.svelte';
import { parse } from '$lib/editor/core/parser';
import { serialize } from '$lib/editor/core/serializer';
import { rebuildContainerRawIfContainer } from '$lib/editor/schema/container-raw';
import {
	mockRef,
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/editor/test/harness/editor-actions';
import type { BlockComponent } from '$lib/editor/block-component';
import type { CstNode } from '$lib/editor/core/nodes';

/**
 * G2.8 — after every structural op the three parallel arrays stay length-matched
 * and index-aligned: `children` ↔ keyed-id array ↔ ref array. This is the
 * post-`splitBlock` keyed-`{#each}` corruption regression that was protected
 * only by "don't do it"; a desync here makes Svelte destroy+recreate the wrong
 * component, dropping IME state or stranding focus.
 *
 * `applyStructuralChangeToIdsRefs` (the commit primitive's auto-sync) is the
 * code under test; the ops drive it through the real action bundles.
 *
 * Scope note (TRIAGE): "reorder" in the spec row has no structural op today —
 * there is no move/reorder primitive in editor-actions or tree-operations
 * (drag-to-reorder is unimplemented). The alignment invariant is exercised by
 * the ops that exist — split / merge / delete / paste — which together cover
 * every StructuralChange shape (insert, delete, replace).
 */

function makeNode(kind: string, raw: string): CstNode {
	return { kind, leadingTrivia: '', raw } as CstNode;
}

// ── Top-level alignment ──────────────────────────────────────────────────────

interface TopHarness {
	doc: ReturnType<typeof makeEditorActionsDeps>['doc'];
	actions: ReturnType<typeof createBlockEditActions>;
	ids: () => string[];
	refs: () => (BlockComponent | undefined)[];
}

function makeTop(raws: string[]): TopHarness {
	const { deps, doc, getBlockIds, getBlockRefs } = makeEditorActionsDeps(
		raws.map((r) => makeNode('paragraph', r))
	);
	const controller = createUndoController(deps);
	const actions = createBlockEditActions(deps, controller);
	return { doc, actions, ids: getBlockIds, refs: getBlockRefs };
}

function assertAligned(h: { doc: { children: CstNode[] }; ids: () => string[]; refs: () => unknown[] }) {
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
		// Split is a replace with idMap {0:0}: first half inherits id0 + ref0,
		// the new second half is fresh, the untouched sibling keeps id1.
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

	it('multi-block paste keeps arrays aligned and pins the host id to the first piece', async () => {
		const h = makeTop(['hello\n', 'tail\n']);
		const [id0, id1] = h.ids();

		await h.actions.insertParsedBlocks(0, 2, [
			makeNode('paragraph', 'x\n'),
			makeNode('paragraph', 'y\n')
		]);

		assertAligned(h);
		expect(h.doc.children.length).toBeGreaterThan(2);
		expect(h.ids()[0]).toBe(id0);
		expect(h.ids().at(-1)).toBe(id1);
	});

	it('round-trip stays byte-stable across a sequence of ops', async () => {
		const h = makeTop(['one\n', 'two\n', 'three\n']);
		// serialize(parse(serialize(doc))) === serialize(doc): the live tree the
		// ops produced reparses to itself, so no op smuggled in unserializable raw.
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
	node: CstNode;
	state: ReturnType<typeof createBlockListState>;
	bundle: ReturnType<typeof createStandardNestedActions>;
}

// Seed innerBlockRefs to mirror a mounted container: createBlockListState starts
// refs as an empty $state array (the {#each} fills it on mount, which never runs
// in node env), so without seeding the ref-alignment check would chase a harness
// artifact, not a real bug. rebuildRaw runs the real container raw-rebuild so
// the container's `raw` tracks its mutated children (the production prelude does
// this after every inner op) — required for the round-trip assertion to be honest.
function makeContainer(source: string): ContainerHarness {
	const node = parse(source).children[0];
	expect(node.children, 'container has children').toBeTruthy();

	const { deps, doc } = makeEditorActionsDeps([node]);
	const controller = createUndoController(deps);
	const containerEdit = createContainerEditActions(deps, controller);
	const state = createBlockListState(() => node);
	state.innerBlockRefs = (node.children ?? []).map(() => mockRef());

	const bundle = createStandardNestedActions(state, {
		index: 0,
		get node() {
			return node;
		},
		rebuildRaw: () => rebuildContainerRawIfContainer(node),
		stickyColumn: makeStickyColumn(),
		parent: {
			blockEdit: makeStubBlockEdit(),
			focus: makeStubFocus(),
			containerEdit
		}
	});

	return { doc, node, state, bundle };
}

function assertContainerAligned(h: ContainerHarness) {
	const n = h.node.children?.length ?? 0;
	expect(h.state.innerBlockIds, 'inner id length').toHaveLength(n);
	expect(h.state.innerBlockRefs, 'inner ref length').toHaveLength(n);
	expect(new Set(h.state.innerBlockIds).size, 'inner ids unique').toBe(n);
}

// A blockquote of paragraphs (blank `>` separators) gives prose children whose
// pairwise merge is eligible — exercising the merge path inside a container,
// which a list of items would not (listItem↔listItem isn't directly mergeable).
const BQ_THREE = '> aaaa\n>\n> bbbb\n>\n> cccc\n';
const BQ_TWO = '> aaaa\n>\n> bbbb\n';

describe('G2.8 container id↔ref↔children alignment', () => {
	it('inner split keeps arrays aligned and pins the original id to the first half', async () => {
		const h = makeContainer(BQ_TWO);
		const [id0, id1] = h.state.innerBlockIds;
		const ref0 = h.state.innerBlockRefs[0];

		await h.bundle.blockEdit.splitBlock(0, 2);

		assertContainerAligned(h);
		expect(h.node.children).toHaveLength(3);
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
		expect(h.node.children).toHaveLength(2);
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
		// The surviving leading slot keeps its ref — the splice removed index 1.
		expect(h.state.innerBlockRefs[0]).toBe(ref0);
	});

	it('inner paste keeps arrays aligned and pins the host id to the first piece', async () => {
		const h = makeContainer(BQ_TWO);
		const [id0, id1] = h.state.innerBlockIds;

		await h.bundle.blockEdit.insertParsedBlocks(0, 2, [
			makeNode('paragraph', 'x\n'),
			makeNode('paragraph', 'y\n')
		]);

		assertContainerAligned(h);
		expect(h.state.innerBlockIds[0]).toBe(id0);
		// id1 (the untouched second item) survives at the tail.
		expect(h.state.innerBlockIds).toContain(id1);
	});

	it('round-trip stays byte-stable and serialized raw tracks the mutated children', async () => {
		const h = makeContainer(BQ_THREE);
		// serialize(parse(serialize(doc))) === serialize(doc): no op produced
		// unserializable raw. This alone passes even on a STALE container raw
		// (valid-but-unupdated GFM self-round-trips), so it's paired below with a
		// content oracle that the serialized blockquote reflects the live edit —
		// that pair is what makes the raw-rebuild load-bearing here.
		const stable = () => {
			const live = serialize(h.doc);
			expect(serialize(parse(live))).toBe(live);
		};

		// Delete the first paragraph: its text must vanish from the serialized
		// blockquote. Without rebuildRaw the container's stale raw still carries
		// "aaaa", so this trips — proving the round-trip + content pair is real.
		await h.bundle.blockEdit.deleteBlock(0);
		stable();
		assertContainerAligned(h);
		expect(serialize(h.doc)).not.toContain('aaaa');
		expect(serialize(h.doc)).toContain('bbbb');

		// Merge the now-first two paragraphs: still byte-stable, still aligned.
		await h.bundle.blockEdit.mergeWithNext(0);
		stable();
		assertContainerAligned(h);
	});
});
