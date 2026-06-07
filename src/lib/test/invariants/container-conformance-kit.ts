/**
 * G4.3 — container-author conformance kit. A parametrized harness run against
 * EVERY registered container kind (derived from the descriptor registry where
 * `isContainer`), so a 1.2 plugin container is auto-covered the moment it
 * registers: the completeness meta-test in `container-conformance.test.ts` fails
 * if a registered container kind has no profile here.
 *
 * The four per-container invariants:
 *   (a) local-index addressing  — children are addressed by their LOCAL index at
 *       each nesting level (the op mutates the right child and emits a path of
 *       local indices, not a global offset).
 *   (b) innermost-first ancestry rebuild — an edit deep in a STRIP nesting chain
 *       rebuilds raw inner→outer, so the root's raw reflects the leaf change.
 *   (c) one undo entry per multi-scope op — a single logical multi-scope op
 *       pushes exactly one undo snapshot.
 *   (d) focus-bubble termination at root — a boundary focus event bubbles up
 *       through nesting and terminates at the root (no loop / escape).
 *
 * Strip vs grid. Strip containers (blockquote/list/listItem) decompose as
 * outer-syntax-around-children, so their `rebuildRaw` reads only their own
 * direct children and the ancestry chain must be rebuilt innermost-first.
 * Grid containers (table/tableRow) re-derive their ENTIRE subtree raw in one
 * `rebuildRaw` (see `rebuildTableRaw` — it rebuilds every row), so the
 * innermost-first ordering invariant doesn't apply; and grid focus is
 * cell-addressed (focusCell rowIdx/colIdx) rather than innerIndex delegation.
 * Those cells are documented BOUNDARY/EXEMPT in the profile, surfaced as a
 * passing assertion that the reason is recorded — never a silent skip.
 *
 * Coverage boundary. Every asserted check drives the real per-kind action path
 * (strip via `createStandardNestedActions`, grid via
 * `createTableMutationsContext`) over a parsed CST — never the shared commit
 * primitive directly, which would pass vacuously for a container that bypasses
 * it. Two node-env boundaries the kit deliberately does not cross: (1) the kit
 * mounts the DEFAULT nested-action bundle, not the per-kind `overrideFactory`
 * the real components supply (blockquote's U2 unwrap, list's exit) — those
 * overrides need the components, so they're out of scope here; (2) grid focus
 * bubbling and a mounted-component focus walk would need the Svelte components
 * under jsdom. Both are recorded as boundaries with what WOULD be required.
 */

import { expect, vi } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { serialize } from '$lib/editor/core/serializer';
import { createUndoController } from '$lib/editor/editor-actions/undo-controller';
import { createContainerEditActions } from '$lib/editor/editor-actions/container-edit';
import {
	createStandardNestedActions,
	type NestedActionsBundle
} from '$lib/editor/editor-actions/nested-actions';
import { createNestedFocus } from '$lib/editor/editor-actions/nested-focus';
import { createTableMutationsContext } from '$lib/editor/editor-actions/table-context';
import { createListContext } from '$lib/editor/editor-actions/list-context';
import { createBlockListState } from '$lib/editor/reactivity/block-list-state.svelte';
import {
	rebuildContainerRawIfContainer,
	rebuildAncestryRawForLeaf
} from '$lib/editor/schema/container-raw';
import {
	mockRef,
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/editor/test/harness/editor-actions';
import type { BlockKind, CstNode, Document } from '$lib/editor/core/nodes';
import type { ContainerEditActions, FocusActions } from '$lib/editor/action-contracts';
import type { EditEvent } from '$lib/editor/editor-events';

// ── Capability map ────────────────────────────────────────────────────────────

type Coverage =
	| { mode: 'assert' }
	| { mode: 'exempt'; reason: string }
	| { mode: 'boundary'; reason: string };

/**
 * `containerChain` is a doc-rooted path of STRIP container indices from the doc
 * root down to (and including) the kind-under-test, mounted as a real nested
 * action chain. The last container in the chain has its non-first child edited.
 */
interface LocalIndexFixture {
	source: string;
	containerChain: number[];
	targetChild: number;
}

export interface ContainerProfile {
	/**
	 * A nesting where this kind is an intermediate ancestor of a deep editable
	 * leaf — used by the strip ancestry-rebuild check. `leafPath` is doc-rooted.
	 */
	deepNesting: { source: string; leafPath: number[] };
	/** Strip-only: where the kind node lives + which non-first child to edit. */
	localIndexFixture?: LocalIndexFixture;
	localIndex: Coverage;
	ancestry: Coverage;
	multiScope: Coverage;
	focusBubble: Coverage;
}

export const CONTAINER_PROFILES: Partial<Record<BlockKind, ContainerProfile>> = {
	blockquote: {
		// outer bq > inner bq (local index 1) > [paragraph, paragraph].
		deepNesting: { source: '> top\n>\n> > inner-a\n> >\n> > inner-b\n', leafPath: [0, 1, 0] },
		localIndexFixture: {
			source: '> top\n>\n> > inner-a\n> >\n> > inner-b\n',
			containerChain: [0, 1],
			targetChild: 1
		},
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		multiScope: {
			mode: 'exempt',
			reason: 'blockquote inner ops (split/merge/delete) are single-scope; no ≥2-scope author op exists'
		},
		focusBubble: { mode: 'assert' }
	},
	list: {
		// outer list > item 1 > nested list (local index 1) > [item, item].
		deepNesting: {
			source: '- top\n- second\n  - nested-a\n  - nested-b\n',
			leafPath: [0, 1, 1, 0, 0]
		},
		localIndexFixture: {
			source: '- top\n- second\n  - nested-a\n  - nested-b\n',
			containerChain: [0, 1, 1],
			targetChild: 1
		},
		localIndex: { mode: 'assert' },
		// indentItem / splitItemAtOffset / promoteNestedItem span ≥2 scopes via commitMultiScope.
		ancestry: { mode: 'assert' },
		multiScope: { mode: 'assert' },
		focusBubble: { mode: 'assert' }
	},
	listItem: {
		// list > item 1 (the listItem under test) > [paragraph, nested list].
		deepNesting: {
			source: '- lead\n- outer\n  - nested-a\n  - nested-b\n',
			leafPath: [0, 1, 1, 0, 0]
		},
		// item 1 has children [paragraph, nested-list]; target the nested-list child.
		localIndexFixture: {
			source: '- lead\n- outer\n  - nested-a\n  - nested-b\n',
			containerChain: [0, 1],
			targetChild: 1
		},
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		multiScope: {
			mode: 'exempt',
			reason:
				'listItem author ops route through the parent list context; the listItem itself owns no ≥2-scope op'
		},
		focusBubble: { mode: 'assert' }
	},
	table: {
		deepNesting: {
			source: '| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n',
			leafPath: [0, 2, 1]
		},
		// Grid local addressing (rows by index) is asserted via table-context.
		localIndex: { mode: 'assert' },
		ancestry: {
			mode: 'boundary',
			reason:
				'grid containerContract: rebuildTableRaw re-derives the ENTIRE table subtree (every row) ' +
				'in one rebuild, so the innermost-first ordering of a chained ancestry rebuild is moot — ' +
				'a single rebuild of the table already reflects any descendant cell edit.'
		},
		// commitColumnEdit spans the table scope + every row scope.
		multiScope: { mode: 'assert' },
		focusBubble: {
			mode: 'boundary',
			reason:
				'grid focus is cell-addressed (focusCell rowIdx/colIdx), not innerIndex delegation; the ' +
				'strip focus-bubble dispatcher is not on the table path. Exercising grid cell-to-cell ' +
				'bubbling would require mounting the table component under jsdom.'
		}
	},
	tableRow: {
		deepNesting: { source: '| h1 |\n| --- |\n| a |\n', leafPath: [0, 1, 0] },
		localIndex: {
			mode: 'boundary',
			reason:
				'tableRow has no standalone author action bundle — its cells are leaves and all row/column ' +
				'ops run through the table scope (createTableMutationsContext). Row local addressing is ' +
				'exercised via the `table` profile.'
		},
		ancestry: {
			mode: 'boundary',
			reason:
				'grid containerContract: tableRow raw is re-derived wholesale by its parent table’s ' +
				'rebuildTableRaw, so the innermost-first chained-rebuild ordering does not apply.'
		},
		multiScope: {
			mode: 'exempt',
			reason: 'tableRow owns no ≥2-scope op; column ops are owned by the enclosing table scope'
		},
		focusBubble: {
			mode: 'boundary',
			reason:
				'grid focus is cell-addressed; tableRow is not on the strip focus-bubble (innerIndex) path'
		}
	}
};

// ── Shared helpers ───────────────────────────────────────────────────────────────

function firstChildOfKind(source: string, kind: BlockKind): CstNode {
	const node = parse(source).children[0];
	expect(node.kind, `sample's first child is "${kind}"`).toBe(kind);
	expect(node.children, 'sample container has children').toBeTruthy();
	return node;
}

function nodeAtPath(root: Document | CstNode, path: number[]): CstNode {
	let cur: Document | CstNode = root;
	for (const i of path) {
		expect(cur.children, 'path step has children').toBeTruthy();
		cur = cur.children![i];
	}
	return cur as CstNode;
}

/** Seed a fresh BlockListState with one mockRef per child (the $effect that fills refs never runs in node env). */
function seededState(getNode: () => CstNode) {
	const state = createBlockListState(getNode);
	state.innerBlockRefs = (getNode().children ?? []).map(() => mockRef({ focus: vi.fn() }));
	return state;
}

// ── (a) local-index addressing (strip) ───────────────────────────────────────────

/**
 * Mount the full strip chain down to the kind-under-test, edit a NON-FIRST child
 * of it (at a NON-ZERO position in its parent chain), and assert (i) the right
 * child mutated — by content — and (ii) the emitted edit path is the chain of
 * LOCAL indices. The non-zero / non-first setup is what discriminates local from
 * global addressing: at chain [0,0] / child 0 a local path coincides with a flat
 * global offset and the test would be vacuous.
 */
export async function checkStripLocalIndexAddressing(profile: ContainerProfile): Promise<void> {
	const fixture = profile.localIndexFixture;
	if (!fixture) throw new Error('checkStripLocalIndexAddressing: profile has no localIndexFixture');
	const { containerChain, targetChild } = fixture;
	expect(containerChain.length, 'chain has a top-level container + ≥1 nested level').toBeGreaterThan(
		1
	);

	const outer = parse(fixture.source).children[0];
	const { deps, doc, events } = makeEditorActionsDeps([outer]);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	// Build the nested action chain: doc → outer (chain[0]) → … → kind node.
	let parentBundle: NestedActionsBundle | null = null;
	let parentContainerEdit: ContainerEditActions = rootContainerEdit;
	let node = outer;
	for (let depth = 0; depth < containerChain.length; depth++) {
		const captured = node;
		const state = seededState(() => captured);
		const bundle = createStandardNestedActions(state, {
			index: containerChain[depth],
			get node() {
				return captured;
			},
			rebuildRaw: () => rebuildContainerRawIfContainer(captured),
			stickyColumn: makeStickyColumn(),
			parent: {
				blockEdit: parentBundle?.blockEdit ?? makeStubBlockEdit(),
				focus: parentBundle?.focus ?? makeStubFocus(),
				containerEdit: parentContainerEdit
			}
		});
		parentBundle = bundle;
		parentContainerEdit = bundle.containerEdit;
		if (depth < containerChain.length - 1) node = node.children![containerChain[depth + 1]];
	}

	const kindNode = node;
	expect(kindNode.children!.length, 'kind node has ≥2 children to target a non-first one').toBeGreaterThan(
		1
	);
	const targetMarker = kindNode.children![targetChild].raw;

	const seen: EditEvent[] = [];
	events.on('edit', (e) => seen.push(e));

	await parentBundle!.blockEdit.deleteBlock(targetChild);

	// (i) content oracle: the addressed local child is the one removed.
	const remaining = (kindNode.children ?? []).map((c) => c.raw);
	expect(remaining, `local index ${targetChild} was the child removed`).not.toContain(targetMarker);
	// (ii) the edit path equals the chain of local indices (+ the targeted child).
	const editEvent = seen.find((e) => e.op === 'delete');
	expect(editEvent, 'a delete edit event fired').toBeTruthy();
	expect(editEvent!.path.slice(0, containerChain.length), 'path is the local-index chain').toEqual(
		containerChain
	);
	expect(editEvent!.path.at(-1), 'path ends at the targeted local child index').toBe(targetChild);

	const live = serialize(doc);
	expect(serialize(parse(live)), 'doc round-trips after a local-index op').toBe(live);
}

/**
 * Grid local addressing: a table column op addresses cells by (rowIdx, colIdx)
 * and emits the table's own local path. Drive insertColumnRight on a table at a
 * NON-zero doc index and assert the right column landed in EVERY row by content.
 */
export async function checkGridLocalIndexAddressing(): Promise<void> {
	// A leading paragraph pushes the table to doc index 1 (non-zero).
	const doc = parse('lead para\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n');
	const table = doc.children[1];
	expect(table.kind, 'table at non-zero doc index').toBe('table');

	const { deps, events } = makeEditorActionsDeps(doc.children);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	const rowsState = seededState(() => table);
	// commitColumnEdit resolves each row via expectStateForNode — register them.
	for (const row of table.children!) seededState(() => row);

	const focusCell = vi.fn();
	const ctx = createTableMutationsContext({
		get node() {
			return table;
		},
		get index() {
			return 1;
		},
		get myPath() {
			return [1];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return { rowIdx: 0, colIdx: 0 };
		},
		parentContainerEdit: rootContainerEdit,
		controller,
		focusCell
	});

	const seen: EditEvent[] = [];
	events.on('edit', (e) => seen.push(e));

	// Insert a column to the RIGHT of column 0 → new empty cell at colIdx 1, the
	// original second cell shifted to colIdx 2. Pinning the POSITION by content is
	// what proves cells are addressed by local col index, not appended at the end.
	await ctx.insertColumnRight(0);

	for (const row of table.children!) {
		const cells = row.children!.map((c) => c.raw);
		expect(cells.length, 'every row gained one cell').toBe(3);
		expect(cells[0], 'column 0 unchanged').not.toBe('');
		expect(cells[1], 'new empty cell landed at the addressed colIdx 1').toBe('');
		expect(cells[2], 'original second cell shifted to colIdx 2').not.toBe('');
	}
	const editEvent = seen.find((e) => e.op === 'tableInsertColumn');
	expect(editEvent, 'tableInsertColumn edit event fired').toBeTruthy();
	expect(editEvent!.path, 'column op emits the table’s own local path').toEqual([1]);
}

// ── (b) innermost-first ancestry rebuild (strip) ─────────────────────────────────

export function checkStripInnermostFirstAncestry(kind: BlockKind, profile: ContainerProfile): void {
	const { source, leafPath } = profile.deepNesting;
	const doc = parse(source);
	const root = doc.children[0];
	expect(pathPassesThroughKind(doc, leafPath, kind), `"${kind}" is on the leaf's ancestry`).toBe(
		true
	);

	const leaf = nodeAtPath(doc, leafPath);
	expect(leaf.children, 'leaf is editable (no children)').toBeFalsy();
	const marker = `zzmark-${kind}`;
	leaf.raw = marker + '\n';

	rebuildAncestryRawForLeaf(doc, leafPath);

	expect(root.raw, `root raw reflects the deep leaf edit through "${kind}"`).toContain(marker);
}

/**
 * Mutation test: a reversed (outer→inner) rebuild leaves the root stale for
 * STRIP nesting (each rebuild reads only direct children, so the root
 * concatenates still-stale inner raw). Proves the innermost-first check is
 * non-vacuous. (Returns false for grid, whose rebuild is self-contained — which
 * is exactly why grid is a boundary, not an assert.)
 */
export function reversedAncestryLeavesRootStale(profile: ContainerProfile): boolean {
	const { source, leafPath } = profile.deepNesting;
	const doc = parse(source);
	const root = doc.children[0];
	const leaf = nodeAtPath(doc, leafPath);
	const marker = 'reversed-mark';
	leaf.raw = marker + '\n';

	const ancestors: CstNode[] = [];
	let cur: Document | CstNode = doc;
	for (let depth = 0; depth < leafPath.length - 1; depth++) {
		cur = cur.children![leafPath[depth]];
		ancestors.push(cur as CstNode);
	}
	// Outermost-first: each ancestor rebuilt before its descendants are fresh.
	for (const a of ancestors) rebuildContainerRawIfContainer(a);

	return !root.raw.includes(marker);
}

function pathPassesThroughKind(doc: Document, leafPath: number[], kind: BlockKind): boolean {
	let cur: Document | CstNode = doc;
	for (let depth = 0; depth < leafPath.length - 1; depth++) {
		cur = cur.children![leafPath[depth]];
		if ((cur as CstNode).kind === kind) return true;
	}
	return false;
}

// ── (c) one undo entry per multi-scope op ────────────────────────────────────────

export async function checkOneUndoPerMultiScope(kind: BlockKind): Promise<void> {
	if (kind === 'list') return checkListIndentOneUndo();
	if (kind === 'table') return checkTableColumnOneUndo();
	throw new Error(`checkOneUndoPerMultiScope: "${kind}" has no multi-scope op to assert`);
}

async function checkListIndentOneUndo(): Promise<void> {
	// Indenting item 1 under item 0 spans outer-list + the new nested-list scope.
	const list = firstChildOfKind('- alpha\n- beta\n', 'list');
	const { deps } = makeEditorActionsDeps([list]);
	const controller = createUndoController(deps);

	const listState = seededState(() => list);
	// indentItem reaches into prevItem (item 0) via expectStateForNode — register each item.
	for (const item of list.children!) seededState(() => item);

	const ctx = createListContext({
		get index() {
			return 0;
		},
		get node() {
			return list;
		},
		state: listState,
		parentBlockEdit: makeStubBlockEdit(),
		parentFocus: makeStubFocus(),
		parentListContext: undefined,
		controller
	});

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.indentItem(1);
	const after = deps.undoManager.getStacks().undo.length;

	expect(after - before, 'list indentItem (multi-scope) pushes exactly ONE undo entry').toBe(1);
	expect(list.children!.length, 'item 1 was indented out of the outer list').toBe(1);
}

async function checkTableColumnOneUndo(): Promise<void> {
	const table = firstChildOfKind('| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n', 'table');
	const { deps } = makeEditorActionsDeps([table]);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	const rowsState = seededState(() => table);
	for (const row of table.children!) seededState(() => row);

	const ctx = createTableMutationsContext({
		get node() {
			return table;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return { rowIdx: 0, colIdx: 0 };
		},
		parentContainerEdit: rootContainerEdit,
		controller,
		focusCell: vi.fn()
	});

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.insertColumnRight(0);
	const after = deps.undoManager.getStacks().undo.length;

	expect(after - before, 'table insertColumn (multi-scope) pushes exactly ONE undo entry').toBe(1);
}

// ── (d) focus-bubble termination at root ──────────────────────────────────────────

/**
 * Wire a real 2-level focus chain through each kind's OWN focus bundle:
 * kind-under-test inner (its `createNestedFocus`) → a strip outer at its own top
 * edge (also `createNestedFocus`) → a stub root. Bubble an out-of-range ArrowUp
 * off the top of the inner container and assert it reaches the root stub exactly
 * once — proving the bubble terminated (no loop back, no double-escape). Calling
 * the kind's bundle (not `dispatchMoveFocus` directly) is what makes this
 * non-vacuous: a plugin whose focus wiring re-enters or double-escapes is caught.
 *
 * Honesty note: strip focus delegation is kind-agnostic (one `createNestedFocus`
 * factory, no per-kind branch), so this proves "this kind's bundle terminates,"
 * not kind-specific bubble logic — there is none to test for the built-ins.
 */
export async function checkFocusBubbleTermination(kind: BlockKind): Promise<void> {
	const innerNode = findFirstOfKind(parse(focusSource(kind)), kind);
	expect(innerNode, `focus source contains a "${kind}" node`).toBeTruthy();
	expect(innerNode!.children?.length, `"${kind}" node has children`).toBeGreaterThan(0);

	const rootFocus: FocusActions = { moveFocus: vi.fn() };

	// Outer strip container at its own top edge: receiving moveFocus(-1) it must
	// delegate to root, not re-enter the inner chain.
	const outerNode = parse('> a\n>\n> b\n').children[0];
	const outerFocus = createNestedFocus(seededState(() => outerNode), {
		index: 3,
		get node() {
			return outerNode;
		},
		rebuildRaw: () => {},
		stickyColumn: makeStickyColumn(),
		parent: { blockEdit: makeStubBlockEdit(), focus: rootFocus, containerEdit: {} as never }
	});

	// The kind's own focus bundle, parented to the outer.
	const innerFocus = createNestedFocus(seededState(() => innerNode!), {
		index: 0,
		get node() {
			return innerNode!;
		},
		rebuildRaw: () => {},
		stickyColumn: makeStickyColumn(),
		parent: { blockEdit: makeStubBlockEdit(), focus: outerFocus, containerEdit: {} as never }
	});

	// ArrowUp off the top of the inner container → inner delegates to
	// outer.moveFocus(-1) → outer is at its own top (index 3) → root once at 2.
	await innerFocus.moveFocus(-1, 'end');

	expect(rootFocus.moveFocus, 'bubble terminated at root exactly once').toHaveBeenCalledTimes(1);
	expect(rootFocus.moveFocus, 'root received the bubbled position').toHaveBeenCalledWith(2, 'end');
}

/** A standalone source whose tree contains a node of `kind` with ≥1 focusable child. */
function focusSource(kind: BlockKind): string {
	switch (kind) {
		case 'blockquote':
			return '> a\n>\n> b\n';
		case 'list':
			return '- a\n- b\n';
		case 'listItem':
			// listItem can't be a parse root — it lives inside a list; the walker
			// below finds the listItem node (whose child is the inner paragraph).
			return '- a\n';
		default:
			throw new Error(`focusSource: "${kind}" is not on the strip focus path`);
	}
}

/** First node of `kind` in a pre-order walk (the kind may be nested below the root). */
function findFirstOfKind(root: Document | CstNode, kind: BlockKind): CstNode | null {
	for (const child of root.children ?? []) {
		if (child.kind === kind) return child;
		const found = findFirstOfKind(child, kind);
		if (found) return found;
	}
	return null;
}

// ── Coverage assertion (visible exemptions) ───────────────────────────────────────

/** Assert an EXEMPT/BOUNDARY cell carries a substantive reason — keeps it visible, never a silent skip. */
export function assertExemptionDocumented(cell: Coverage, label: string): void {
	if (cell.mode === 'assert') {
		throw new Error(`assertExemptionDocumented called on an 'assert' cell: ${label}`);
	}
	expect(cell.reason.length, `${label} ${cell.mode} reason is documented`).toBeGreaterThan(20);
}
