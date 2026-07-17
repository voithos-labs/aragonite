/**
 * G4.3 — the container conformance kit, published at `aragonite/testing`.
 *
 * A parametrized harness a container author points at their own kind. The caller
 * supplies the kind and a profile: the fixtures the kit parses, plus a coverage
 * matrix declaring, per invariant, whether the kind asserts it or is exempt from
 * it. `runContainerConformance` is the entry; the granular checks are exported
 * for a sweep that wants one test case per invariant.
 *
 * The invariants:
 *   (a) local-index addressing  — children are addressed by their LOCAL index at
 *       each nesting level (the op mutates the right child and emits a path of
 *       local indices, not a global offset).
 *   (b) innermost-first ancestry rebuild — an edit deep in a STRIP nesting chain
 *       rebuilds raw inner→outer, so the root's raw reflects the leaf change.
 *   (c) one undo entry per multi-scope op — a single logical multi-scope op
 *       pushes exactly one undo snapshot.
 *   (d) focus-bubble termination at root — a boundary focus event bubbles up
 *       through nesting and terminates at the root (no loop / escape).
 *   (e) declaration sanity — the descriptor's declared behaviors hold: a
 *       declared unwrapRole names implemented strategies, a declared
 *       containerPaste is shaped as the paste path consumes it, and rebuildRaw
 *       runs non-throwing over a parsed fixture.
 *
 * Register your kind before calling: the kit parses its fixtures, so the opener
 * (or directive) that produces the kind must be live.
 *
 * Strip vs grid vs opaque. Strip containers decompose as outer-syntax-around-
 * children, so their `rebuildRaw` reads only their own direct children and the
 * ancestry chain must be rebuilt innermost-first — the same holds for `'opaque'`
 * containers, whose rebuild re-derives raw from children too. Grid containers
 * re-derive their ENTIRE subtree raw in one `rebuildRaw`, so the innermost-first
 * ordering invariant doesn't apply; and grid focus is cell-addressed (focusCell
 * rowIdx/colIdx) rather than innerIndex delegation. Cells like those are declared
 * BOUNDARY/EXEMPT in the profile, reported as such with their reason — never a
 * silent skip, and a thin reason fails the run.
 *
 * Coverage boundary. Every asserted check drives the real per-kind action path
 * over a parsed CST — never the shared commit primitive directly, which would
 * pass vacuously for a container that bypasses it. Two boundaries the kit does
 * not cross: it mounts the DEFAULT nested-action bundle, not a per-kind
 * `overrideFactory` (those need the components); and a mounted-component focus
 * walk would need a DOM. Both would require rendering the editor.
 *
 * Failures throw a plain `Error` — no test runner is imported, so the kit runs
 * unchanged under Vitest, Jest or `node:test`.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { createContainerEditActions } from '../editor-actions/container-edit';
import { createUndoController } from '../editor-actions/commit/undo-controller';
import { createListContext } from '../editor-actions/list-context';
import {
	createStandardNestedActions,
	type NestedActionsBundle
} from '../editor-actions/nested/nested-actions';
import { createNestedFocus } from '../editor-actions/nested/nested-focus';
import { createTableMutationsContext } from '../editor-actions/table-context';
import {
	firstChildUnwrapStrategies,
	middleChildUnwrapStrategies
} from '../editor-actions/unwrap-strategies';
import type { EditEvent } from '../editor-events';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import { createSharingState } from '../tree-operations/sharing';
import { rebuildUnsharedAncestry } from '../tree-operations/unshare';
import {
	createHeadlessActions,
	mountBlockListState,
	recordingFocus,
	stubBlockEdit,
	stubStickyColumn
} from './headless-actions';
import {
	assert,
	assertExemptionDocumented,
	assertIndices,
	assertIs,
	fail,
	findFirstOfKind,
	firstChildOfKind,
	nodeAtPath,
	pathPassesThroughKind,
	type ConformanceCoverage
} from './conformance-core';

// The container-structural cells' test imports these two through this module.
export { assertExemptionDocumented, type ConformanceCoverage };

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * `containerChain` is a doc-rooted path of container indices from the doc root
 * down to (and including) the kind-under-test, mounted as a real nested action
 * chain. The last container in the chain has its `targetChild` edited — pick a
 * NON-first child at a NON-zero chain position, or the check is vacuous (see
 * `checkStripLocalIndexAddressing`).
 */
export interface LocalIndexFixture {
	source: string;
	containerChain: number[];
	targetChild: number;
}

export interface ContainerConformanceProfile {
	/**
	 * A nesting where this kind is an intermediate ancestor of a deep editable
	 * leaf. `leafPath` is doc-rooted.
	 */
	deepNesting: { source: string; leafPath: number[] };
	/** Required when `localIndex` asserts (strip/opaque kinds; grid has its own path). */
	localIndexFixture?: LocalIndexFixture;
	/** Required when `focusBubble` asserts: a source whose tree holds a node of the kind with ≥1 child. */
	focusSource?: string;
	localIndex: ConformanceCoverage;
	ancestry: ConformanceCoverage;
	multiScope: ConformanceCoverage;
	focusBubble: ConformanceCoverage;
}

// ── Report ───────────────────────────────────────────────────────────────────

export type ConformanceCell =
	| 'localIndex'
	| 'ancestry'
	| 'multiScope'
	| 'focusBubble'
	| 'declarations';

export interface ConformanceCellReport {
	cell: ConformanceCell;
	status: 'asserted' | 'exempt' | 'boundary';
	reason?: string;
}

export interface ContainerConformanceReport {
	kind: AnyBlockKind;
	cells: ConformanceCellReport[];
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run every conformance cell for `kind`. Resolves with the coverage report when
 * the asserted cells hold and the exempt/boundary cells carry a reason; throws
 * an `Error` naming every failed cell otherwise.
 */
export async function runContainerConformance(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): Promise<ContainerConformanceReport> {
	const isGrid = getBlockKindDescriptor(kind).containerContract === 'grid';
	const cells: ConformanceCellReport[] = [];
	const failures: string[] = [];

	const runCell = async (
		cell: ConformanceCell,
		coverage: ConformanceCoverage,
		assertion: () => void | Promise<void>
	) => {
		try {
			if (coverage.mode === 'assert') {
				await assertion();
				cells.push({ cell, status: 'asserted' });
			} else {
				assertExemptionDocumented(coverage, `${kind} ${cell}`);
				cells.push({ cell, status: coverage.mode, reason: coverage.reason });
			}
		} catch (error) {
			failures.push(`${cell}: ${(error as Error).message}`);
		}
	};

	await runCell('localIndex', profile.localIndex, () =>
		isGrid ? checkGridLocalIndexAddressing() : checkStripLocalIndexAddressing(profile)
	);
	await runCell('ancestry', profile.ancestry, () => checkInnermostFirstAncestry(kind, profile));
	await runCell('multiScope', profile.multiScope, () => checkOneUndoPerMultiScope(kind));
	await runCell('focusBubble', profile.focusBubble, () =>
		checkFocusBubbleTermination(kind, profile)
	);
	await runCell('declarations', { mode: 'assert' }, () => checkDeclarationSanity(kind, profile));

	if (failures.length > 0) {
		throw new Error(`container conformance failed for "${kind}":\n  - ${failures.join('\n  - ')}`);
	}
	return { kind, cells };
}

// ── (a) local-index addressing ───────────────────────────────────────────────

/**
 * Mount the full nested chain down to the kind-under-test, edit a NON-FIRST child
 * of it (at a NON-ZERO position in its parent chain), and assert (i) the right
 * child mutated — by content — and (ii) the emitted edit path is the chain of
 * LOCAL indices. The non-zero / non-first setup is what discriminates local from
 * global addressing: at chain [0,0] / child 0 a local path coincides with a flat
 * global offset and the check would be vacuous.
 */
export async function checkStripLocalIndexAddressing(
	profile: ContainerConformanceProfile
): Promise<void> {
	const fixture = profile.localIndexFixture;
	if (!fixture) fail('localIndex asserts but the profile carries no localIndexFixture');
	const { containerChain, targetChild } = fixture;
	assert(containerChain.length > 1, 'chain has a top-level container + ≥1 nested level');

	const outer = parse(fixture.source).children[0];
	const { deps, doc, events } = createHeadlessActions([outer]);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	// Build the nested action chain: doc → outer (chain[0]) → … → kind node.
	let parentBundle: NestedActionsBundle | null = null;
	let parentContainerEdit: ContainerEditActions = rootContainerEdit;
	let node = outer;
	for (let depth = 0; depth < containerChain.length; depth++) {
		const captured = node;
		const state = mountBlockListState(() => captured);
		const bundle = createStandardNestedActions(state, {
			index: containerChain[depth],
			get node() {
				return captured;
			},
			path: containerChain.slice(0, depth + 1),
			stickyColumn: stubStickyColumn(),
			parent: {
				blockEdit: parentBundle?.blockEdit ?? stubBlockEdit(),
				focus: parentBundle?.focus ?? recordingFocus(),
				containerEdit: parentContainerEdit
			}
		});
		parentBundle = bundle;
		parentContainerEdit = bundle.containerEdit;
		if (depth < containerChain.length - 1) node = node.children![containerChain[depth + 1]];
	}

	const kindNode = node;
	assert(kindNode.children!.length > 1, 'kind node has ≥2 children to target a non-first one');
	const targetMarker = kindNode.children![targetChild].raw;

	const seen: EditEvent[] = [];
	events.on('edit', (e) => seen.push(e));

	await parentBundle!.blockEdit.deleteBlock(targetChild);

	// (i) content oracle: the addressed local child is the one removed. The commit
	// replaced the spine's nodes — re-resolve through the live doc.
	const liveKind = nodeAtPath(doc, containerChain);
	const remaining = (liveKind.children ?? []).map((c) => c.raw);
	assert(!remaining.includes(targetMarker), `local index ${targetChild} was the child removed`);
	// (ii) the edit path equals the chain of local indices (+ the targeted child).
	const editEvent = seen.find((e) => e.op === 'delete');
	assert(editEvent, 'a delete edit event fired');
	assertIndices(
		editEvent.path.slice(0, containerChain.length),
		containerChain,
		'path is the local-index chain'
	);
	assertIs(editEvent.path.at(-1), targetChild, 'path ends at the targeted local child index');

	const live = serialize(doc);
	assertIs(serialize(parse(live)), live, 'doc round-trips after a local-index op');
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
	assertIs(table.kind, 'table', 'table at non-zero doc index');

	const { deps, events } = createHeadlessActions(doc.children);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	const rowsState = mountBlockListState(() => table);
	// commitColumnEdit resolves each row via expectStateForNode — register them.
	for (const row of table.children!) mountBlockListState(() => row);

	const ctx = createTableMutationsContext({
		get node() {
			return table;
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
		focusCell: () => {},
		announceReorder: () => {}
	});

	const seen: EditEvent[] = [];
	events.on('edit', (e) => seen.push(e));

	// Insert a column to the RIGHT of column 0 → new empty cell at colIdx 1, the
	// original second cell shifted to colIdx 2. Pinning the POSITION by content is
	// what proves cells are addressed by local col index, not appended at the end.
	await ctx.insertColumnRight(0);

	const liveTable = deps.doc.children[1];
	for (const row of liveTable.children!) {
		const cells = row.children!.map((c) => c.raw);
		assertIs(cells.length, 3, 'every row gained one cell');
		assert(cells[0] !== '', 'column 0 unchanged');
		assertIs(cells[1], '', 'new empty cell landed at the addressed colIdx 1');
		assert(cells[2] !== '', 'original second cell shifted to colIdx 2');
	}
	const editEvent = seen.find((e) => e.op === 'tableInsertColumn');
	assert(editEvent, 'tableInsertColumn edit event fired');
	assertIndices(editEvent.path, [1], 'column op emits the table’s own local path');
}

// ── (b) innermost-first ancestry rebuild ─────────────────────────────────────

export function checkInnermostFirstAncestry(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): void {
	const { source, leafPath } = profile.deepNesting;
	const doc = parse(source);
	const root = doc.children[0];
	assert(pathPassesThroughKind(doc, leafPath, kind), `"${kind}" is on the leaf's ancestry`);

	const leaf = nodeAtPath(doc, leafPath);
	assert(!leaf.children, 'leaf is editable (no children)');
	const marker = `zzmark-${kind}`;
	leaf.raw = marker + '\n';

	// Fresh sharing state: nothing is shared, so this is a pure ancestry rebuild.
	rebuildUnsharedAncestry(doc, leafPath, createSharingState());

	assert(root.raw.includes(marker), `root raw reflects the deep leaf edit through "${kind}"`);
}

/**
 * Mutation probe: a reversed (outer→inner) rebuild must leave the root stale for
 * a container whose rebuild reads only its direct children (strip/opaque) — the
 * root concatenates still-stale inner raw. Assert it alongside the ancestry check
 * to prove that check is non-vacuous. (Returns false for a container whose
 * rebuild re-derives its whole subtree, e.g. grid — which is exactly why grid
 * declares ancestry a boundary rather than an assert.)
 */
export function reversedAncestryLeavesRootStale(profile: ContainerConformanceProfile): boolean {
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
		ancestors.push(cur);
	}
	// Outermost-first: each ancestor rebuilt before its descendants are fresh.
	for (const a of ancestors) rebuildContainerRawIfContainer(a);

	return !root.raw.includes(marker);
}

// ── (c) one undo entry per multi-scope op ────────────────────────────────────

/**
 * A multi-scope op is inherently kind-specific — it is driven through the kind's
 * own context, not a generic bundle. The built-ins that own one are dispatched
 * here; a kind with no ≥2-scope author op declares `multiScope` exempt and never
 * reaches this.
 */
export async function checkOneUndoPerMultiScope(kind: AnyBlockKind): Promise<void> {
	if (kind === 'list') return checkListIndentOneUndo();
	if (kind === 'table') return checkTableColumnOneUndo();
	fail(
		`"${kind}" asserts multiScope but the kit drives no multi-scope op for it — ` +
			`declare the cell exempt if the kind owns no ≥2-scope op`
	);
}

async function checkListIndentOneUndo(): Promise<void> {
	// Indenting item 1 under item 0 spans outer-list + the new nested-list scope.
	const list = firstChildOfKind('- alpha\n- beta\n', 'list');
	const { deps } = createHeadlessActions([list]);
	const controller = createUndoController(deps);

	const listState = mountBlockListState(() => list);
	// indentItem reaches into prevItem (item 0) via expectStateForNode — register each item.
	for (const item of list.children!) mountBlockListState(() => item);

	const ctx = createListContext({
		get index() {
			return 0;
		},
		get node() {
			return list;
		},
		get path() {
			return [0];
		},
		state: listState,
		parentBlockEdit: stubBlockEdit(),
		parentFocus: recordingFocus(),
		parentListContext: undefined,
		controller
	});

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.indentItem(1);
	const after = deps.undoManager.getStacks().undo.length;

	assertIs(after - before, 1, 'list indentItem (multi-scope) pushes exactly ONE undo entry');
	assertIs(deps.doc.children[0].children!.length, 1, 'item 1 was indented out of the outer list');
}

async function checkTableColumnOneUndo(): Promise<void> {
	const table = firstChildOfKind('| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n', 'table');
	const { deps } = createHeadlessActions([table]);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	const rowsState = mountBlockListState(() => table);
	for (const row of table.children!) mountBlockListState(() => row);

	const ctx = createTableMutationsContext({
		get node() {
			return table;
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
		focusCell: () => {},
		announceReorder: () => {}
	});

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.insertColumnRight(0);
	const after = deps.undoManager.getStacks().undo.length;

	assertIs(after - before, 1, 'table insertColumn (multi-scope) pushes exactly ONE undo entry');
}

// ── (d) focus-bubble termination at root ─────────────────────────────────────

/**
 * Wire a real 2-level focus chain through the kind's OWN focus bundle:
 * kind-under-test inner (its `createNestedFocus`) → a strip outer at its own top
 * edge (also `createNestedFocus`) → a recording root. Bubble an out-of-range
 * ArrowUp off the top of the inner container and assert it reaches the root
 * exactly once — proving the bubble terminated (no loop back, no double-escape).
 * Calling the kind's bundle (not `dispatchMoveFocus` directly) is what makes this
 * non-vacuous: a container whose focus wiring re-enters or double-escapes is caught.
 */
export async function checkFocusBubbleTermination(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): Promise<void> {
	const source = profile.focusSource;
	if (!source) fail('focusBubble asserts but the profile carries no focusSource');

	const innerNode = findFirstOfKind(parse(source), kind);
	assert(innerNode, `focusSource contains a "${kind}" node`);
	assert((innerNode.children?.length ?? 0) > 0, `"${kind}" node has children`);

	const rootFocus = recordingFocus();

	// Outer strip container at its own top edge: receiving moveFocus(-1) it must
	// delegate to root, not re-enter the inner chain.
	const outerNode = parse('> a\n>\n> b\n').children[0];
	const outerFocus = createNestedFocus(
		mountBlockListState(() => outerNode),
		{
			index: 3,
			get node() {
				return outerNode;
			},
			path: [3],
			stickyColumn: stubStickyColumn(),
			parent: { blockEdit: stubBlockEdit(), focus: rootFocus, containerEdit: {} as never }
		}
	);

	// The kind's own focus bundle, parented to the outer.
	const innerFocus = createNestedFocus(
		mountBlockListState(() => innerNode),
		{
			index: 0,
			get node() {
				return innerNode;
			},
			path: [0],
			stickyColumn: stubStickyColumn(),
			parent: { blockEdit: stubBlockEdit(), focus: outerFocus, containerEdit: {} as never }
		}
	);

	// ArrowUp off the top of the inner container → inner delegates to
	// outer.moveFocus(-1) → outer is at its own top (index 3) → root once at 2.
	await innerFocus.moveFocus(-1, 'end');

	assertIs(rootFocus.moveFocusCalls.length, 1, 'bubble terminated at root exactly once');
	const bubbled = rootFocus.moveFocusCalls[0] ?? [];
	assertIs(bubbled.length, 2, 'root received exactly (index, position)');
	assertIs(bubbled[0], 2, 'root received the bubbled index');
	assertIs(bubbled[1], 'end', 'root received the bubbled position');
}

// ── (e) declaration sanity ───────────────────────────────────────────────────

/**
 * Hold the kind to its schema declarations: a declared `unwrapRole` must name
 * strategies the registries implement (the nested dispatcher indexes them
 * unguarded), a declared `containerPaste` must be shaped as the paste path
 * consumes it, and `rebuildRaw` must run non-throwing over a parsed fixture.
 */
export function checkDeclarationSanity(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): void {
	const descriptor = getBlockKindDescriptor(kind);

	const role = descriptor.unwrapRole;
	if (role) {
		assertIs(
			typeof firstChildUnwrapStrategies[role.firstChildBackspace],
			'function',
			`${kind} first-child unwrap strategy "${role.firstChildBackspace}" is implemented`
		);
		if (role.middleChildBackspace !== 'default-merge') {
			assertIs(
				typeof middleChildUnwrapStrategies[role.middleChildBackspace],
				'function',
				`${kind} middle-child unwrap strategy "${role.middleChildBackspace}" is implemented`
			);
		}
	}

	if (descriptor.containerPaste) {
		assertIs(
			typeof descriptor.containerPaste.matchesAncestor,
			'function',
			`${kind} containerPaste.matchesAncestor is callable`
		);
		assertIs(
			typeof descriptor.containerPaste.siblingAbsorb,
			'boolean',
			`${kind} containerPaste.siblingAbsorb is boolean`
		);
	}

	assertIs(typeof descriptor.rebuildRaw, 'function', `${kind} declares rebuildRaw`);
	const node = findFirstOfKind(parse(profile.deepNesting.source), kind);
	assert(node, `deepNesting fixture contains a "${kind}" node`);
	try {
		descriptor.rebuildRaw!(node);
	} catch (error) {
		fail(`${kind} rebuildRaw throws over a parsed fixture: ${(error as Error).message}`);
	}
}
