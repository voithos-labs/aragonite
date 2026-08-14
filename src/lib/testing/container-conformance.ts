/**
 * G4.3 — container conformance kit, published at `aragonite/testing`. Register your kind, then
 * point the kit at it with fixtures plus a coverage matrix declaring per invariant whether it
 * asserts or is excused (never a silent skip; a thin reason fails the run). Which answer a
 * container owes each cell is in the plugin guide's "Conformance-testing a container". Asserted
 * checks drive the real per-kind action path, stopping at the nested-action default and at a DOM.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import { splitLines, trailingLineEnding } from '../core/lines';
import { parse } from '../core/parser';
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
import { isDirectiveKind } from '../core/directive/registry';
import { isBlockOpenerRegistered } from '../schema/block-openers';
import { getBlockKindDescriptor, type BlockKindDescriptor } from '../schema/block-kind-descriptor';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import { createSharingState } from '../tree-operations/sharing';
import { rebuildUnsharedAncestry } from '../tree-operations/unshare';
import { assertParseConverged } from './parse-convergence';
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
	assertRebuildIsParseCanonical,
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
 * `containerChain` is doc-rooted, from the doc root down to and including the
 * kind-under-test. Its last container has `targetChild` edited — pick a NON-first child
 * or a NON-zero chain position, or the check is vacuous (`checkStripLocalIndexAddressing`).
 */
export interface LocalIndexFixture {
	source: string;
	containerChain: number[];
	targetChild: number;
}

/**
 * `source` must parse to a document whose FIRST top-level block is the kind under
 * test; `bodyRaw` replaces that node's LAST child and must contain a line
 * reproducing the container's terminator (a bare `:::` for a colon fence, a
 * `</details>` line for an HTML close tag).
 */
export interface TerminatorCollisionFixture {
	source: string;
	bodyRaw: string;
}

export interface ContainerConformanceProfile {
	/** A nesting where this kind is an intermediate ancestor of the doc-rooted `leafPath`. */
	deepNesting: { source: string; leafPath: number[] };
	/** Required when `localIndex` asserts (strip/opaque kinds; grid has its own path). */
	localIndexFixture?: LocalIndexFixture;
	/** Required when `focusBubble` asserts: a source whose tree holds a node of the kind with ≥1 child. */
	focusSource?: string;
	/** Required when `terminatorCollision` asserts. `bodyRaw` goes through the kind's
	 *  `bodyWrite` rule, so it names the bytes a USER produces, not what reaches the tree. */
	terminatorCollisionFixture?: TerminatorCollisionFixture;
	localIndex: ConformanceCoverage;
	ancestry: ConformanceCoverage;
	multiScope: ConformanceCoverage;
	focusBubble: ConformanceCoverage;
	terminatorCollision: ConformanceCoverage;
}

// ── Report ───────────────────────────────────────────────────────────────────

export type ConformanceCell =
	'localIndex' | 'ancestry' | 'multiScope' | 'focusBubble' | 'terminatorCollision' | 'declarations';

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
 * Run every conformance cell for `kind`. Resolves with the coverage report, or throws an
 * `Error` naming every failed cell.
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
	await runCell('terminatorCollision', profile.terminatorCollision, () =>
		checkTerminatorCollision(kind, profile)
	);
	await runCell('declarations', { mode: 'assert' }, () => checkDeclarationSanity(kind, profile));

	if (failures.length > 0) {
		throw new Error(`container conformance failed for "${kind}":\n  - ${failures.join('\n  - ')}`);
	}
	return { kind, cells };
}

// ── (a) local-index addressing ───────────────────────────────────────────────

/**
 * Assert the addressed child is the one that mutated (by content) and that the emitted
 * path is the chain of LOCAL indices. The non-first / non-zero setup is what
 * discriminates local from global addressing; at chain [0,0] child 0 the two coincide.
 */
export async function checkStripLocalIndexAddressing(
	profile: ContainerConformanceProfile
): Promise<void> {
	const fixture = profile.localIndexFixture;
	if (!fixture) fail('localIndex asserts but the profile carries no localIndexFixture');
	const { containerChain, targetChild } = fixture;
	assert(containerChain.length > 1, 'chain has a top-level container + ≥1 nested level');
	assert(
		targetChild > 0 || containerChain.some((idx) => idx > 0),
		'localIndexFixture must edit a non-first child or descend through a non-zero chain position (else the local-vs-global check is vacuous)'
	);

	const outer = parse(fixture.source).children[0];
	const { deps, doc, events } = createHeadlessActions([outer]);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	let parentBundle: NestedActionsBundle | null = null;
	let parentContainerEdit: ContainerEditActions = rootContainerEdit;
	let node = outer;
	for (let depth = 0; depth < containerChain.length; depth++) {
		const captured = node;
		const state = mountBlockListState(() => captured);
		const bundle = createStandardNestedActions(state, {
			scope: {
				index: containerChain[depth],
				get node() {
					return captured;
				},
				path: containerChain.slice(0, depth + 1)
			},
			stickyColumn: stubStickyColumn(),
			getPresentationMode: undefined,
			linkRef: undefined,
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

	// The commit replaced the spine's nodes — re-resolve through the live doc.
	const liveKind = nodeAtPath(doc, containerChain);
	const remaining = (liveKind.children ?? []).map((c) => c.raw);
	assert(!remaining.includes(targetMarker), `local index ${targetChild} was the child removed`);
	const editEvent = seen.find((e) => e.op === 'delete');
	assert(editEvent, 'a delete edit event fired');
	assertIndices(
		editEvent.path.slice(0, containerChain.length),
		containerChain,
		'path is the local-index chain'
	);
	assertIs(editEvent.path.at(-1), targetChild, 'path ends at the targeted local child index');

	// Convergence, not byte round-trip (which is a tautology here): a local-index op
	// leaving a stale container raw or a divergent shape fires.
	assertParseConverged(doc, 'doc converges after a local-index op');
}

/**
 * Grid local addressing: a table column op addresses cells by (rowIdx, colIdx) and emits
 * the table's own local path. The leading paragraph keeps the table at a non-zero doc
 * index, so a flat global offset would not coincide with the local one.
 */
export async function checkGridLocalIndexAddressing(): Promise<void> {
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

	// Pinning the new cell's POSITION by content is what proves cells are addressed by
	// local col index rather than appended at the end.
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

	// Fresh sharing state, no fold sink and the global grammar: this probe asserts raw propagation
	// only, and a kit owning neither ids nor refs can reconcile no parent-scope splice.
	rebuildUnsharedAncestry(doc, leafPath, createSharingState(), null, undefined);

	assert(root.raw.includes(marker), `root raw reflects the deep leaf edit through "${kind}"`);
}

/**
 * Mutation probe proving the ancestry check is non-vacuous: a reversed (outer→inner)
 * rebuild leaves the root stale for a strip/opaque container. Returns false for a
 * container that re-derives its whole subtree (grid), which is why grid excuses ancestry.
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
 * A multi-scope op is kind-specific: it drives through the kind's own context, not a
 * generic bundle, so only the built-ins that own one are dispatched here.
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
		scope: {
			get index() {
				return 0;
			},
			get node() {
				return list;
			},
			get path() {
				return [0];
			}
		},
		state: listState,
		parentBlockEdit: stubBlockEdit(),
		parentFocus: recordingFocus(),
		parentListContext: undefined,
		controller,
		getPresentationMode: undefined,
		linkRef: undefined
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
 * Bubble an out-of-range ArrowUp through a real 2-level chain (kind-under-test → strip
 * outer at its own top edge → recording root) and assert it reaches the root exactly
 * once. Driving the kind's own bundle rather than `dispatchMoveFocus` is what catches a
 * container whose focus wiring re-enters or double-escapes.
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

	// At its own top edge, so moveFocus(-1) must delegate to root rather than re-enter.
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
			getPresentationMode: undefined,
			linkRef: undefined,
			parent: { blockEdit: stubBlockEdit(), focus: rootFocus, containerEdit: {} as never }
		}
	);

	const innerFocus = createNestedFocus(
		mountBlockListState(() => innerNode),
		{
			index: 0,
			get node() {
				return innerNode;
			},
			path: [0],
			stickyColumn: stubStickyColumn(),
			getPresentationMode: undefined,
			linkRef: undefined,
			parent: { blockEdit: stubBlockEdit(), focus: outerFocus, containerEdit: {} as never }
		}
	);

	// Inner delegates to outer.moveFocus(-1); outer is at its own top (index 3), so the
	// root sees index 2 exactly once.
	await innerFocus.moveFocus(-1, 'end');

	assertIs(rootFocus.moveFocusCalls.length, 1, 'bubble terminated at root exactly once');
	const bubbled = rootFocus.moveFocusCalls[0] ?? [];
	assertIs(bubbled.length, 2, 'root received exactly (index, position)');
	assertIs(bubbled[0], 2, 'root received the bubbled index');
	assertIs(bubbled[1], 'end', 'root received the bubbled position');
}

// ── (f) terminator collision ─────────────────────────────────────────────────

/**
 * Write a terminator-shaped line into the container's last child through `bodyWrite` (the
 * door the commit path uses) and require the live tree to still converge with a fresh
 * parse. Convergence is the oracle, not byte round-trip: `serialize(parse(s)) === s` holds
 * throughout a collision while the container silently stops containing what it says it does.
 */
export function checkTerminatorCollision(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): void {
	const fixture = profile.terminatorCollisionFixture;
	if (!fixture)
		fail('terminatorCollision asserts but the profile carries no terminatorCollisionFixture');

	const doc = parse(fixture.source);
	const node = doc.children[0];
	assertIs(node?.kind, kind, 'terminatorCollisionFixture source opens with a node of the kind');
	const children = node.children ?? [];
	assert(children.length > 0, 'the fixture node has a body child to overwrite');

	const bodyWrite = getBlockKindDescriptor(kind).bodyWrite;
	children[children.length - 1].raw = bodyWrite
		? bodyWrite.normalize(fixture.bodyRaw)
		: fixture.bodyRaw;
	rebuildContainerRawIfContainer(node);

	assertParseConverged(doc, `${kind} survives a body line reproducing its terminator`);
}

// ── (e) declaration sanity ───────────────────────────────────────────────────

/**
 * Hold the kind to its schema declarations. A declared `unwrapRole` must name implemented
 * strategies because the nested dispatcher indexes them unguarded, and a capability whose only
 * job is a cell's repair may not ship behind that cell's excuse.
 */
export function checkDeclarationSanity(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): void {
	const descriptor = getBlockKindDescriptor(kind);

	if (descriptor.bodyWrite && profile.terminatorCollision.mode !== 'assert') {
		fail(
			`${kind} declares container.bodyWrite but its profile marks terminatorCollision ` +
				`"${profile.terminatorCollision.mode}" — the rule exists only to repair that collision, ` +
				`so assert the cell with a fixture whose body reproduces the terminator`
		);
	}

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
	assertRebuildIsParseCanonical(descriptor, node, kind);
	assertBodyWrapMatchesParse(kind, descriptor);
	assertContentStartSpaceIsRebuilt(kind, descriptor);
}

/** The content a probe writes into a body child; distinctive enough that no fixture line ends
 *  in it by accident. */
const CONTENT_START_PROBE = 'probe';

/**
 * `container.contentStartSpace` consumes the user's space, so it is byte-honest only where the
 * rebuild mints that space back on a content line. A declarer whose rebuild does not eats the
 * keystroke instead of deferring it.
 */
function assertContentStartSpaceIsRebuilt(
	kind: AnyBlockKind,
	descriptor: BlockKindDescriptor
): void {
	if (descriptor.contentStartSpace !== 'complete-marker') return;
	const fixture = descriptor.conformanceFixture;
	if (fixture === undefined) {
		fail(`${kind} declares container.contentStartSpace but carries no conformanceFixture to probe`);
	}
	const node = parse(fixture).children.find((child) => child.kind === kind);
	assert(node?.children?.length, `${kind} conformanceFixture opens a "${kind}" with a body child`);

	// The LAST child, so a reserved-chrome head (a title, a summary) stays in place: its own line
	// already carries the opener's space, and rebuilding over it would answer for the wrong line.
	const last = node.children[node.children.length - 1];
	last.raw = CONTENT_START_PROBE + (trailingLineEnding(last.raw) || '\n');
	descriptor.rebuildRaw!(node);

	const lines = splitLines(node.raw)
		.map((line) => line.text)
		.filter((text) => text.endsWith(CONTENT_START_PROBE));
	assertIs(lines.length, 1, `${kind} rebuild emits exactly one line for the probed body child`);
	const line = lines[0];
	assert(
		line.endsWith(` ${CONTENT_START_PROBE}`) && line.length > CONTENT_START_PROBE.length + 1,
		`${kind} declares container.contentStartSpace but its rebuildRaw emits "${line}" for a body ` +
			`child holding "${CONTENT_START_PROBE}" — the consumed space is only deferred where the ` +
			`rebuild re-emits the marker's own trailing space on a content line`
	);
}

/**
 * `container.bodyWrap` is probed, never trusted: the separator settle reads it to decide whether
 * a freed blank line belongs to the wrap, and a kind whose parse disagrees loses its body head
 * on reload (`tree-operations/node-ops.clearRedundantSeparator`).
 */
function assertBodyWrapMatchesParse(kind: AnyBlockKind, descriptor: BlockKindDescriptor): void {
	if (descriptor.containerContract === 'grid') return;
	const fixture = descriptor.conformanceFixture;
	if (fixture === undefined) {
		fail(
			`${kind} declares no conformanceFixture, so the bodyWrap probe cannot run — it asserts ` +
				`the declaration in both directions, so every non-grid container needs a fixture ` +
				`whose top level opens a "${kind}" carrying a body`
		);
	}
	// A kind with no standalone recognizer (listItem) can only ever be nested, so it is probed
	// where the fixture puts it; openers alone misread directive kinds, whose recognizer is the
	// shared `:::`.
	const doc = parse(fixture);
	const opensAtTop = isBlockOpenerRegistered(kind) || isDirectiveKind(kind);
	const node = opensAtTop
		? doc.children.find((child) => child.kind === kind)
		: findFirstOfKind(doc, kind);
	assert(
		node,
		`${kind} conformanceFixture must ${opensAtTop ? 'open' : 'carry'} a "${kind}"` +
			`${opensAtTop ? ' at the top level' : ''} — the bodyWrap probe rebuilds and reparses that ` +
			`node, and a fixture without one would skip it silently while the declarations cell reads ` +
			`asserted`
	);
	assert(
		node.children?.length,
		`${kind} conformanceFixture opens a "${kind}" with no body child, leaving its ` +
			`container.bodyWrap declaration unprobed`
	);

	const expected = node.children.length;
	const ending = trailingLineEnding(node.raw) || '\n';
	node.innerPrefix = '';
	descriptor.rebuildRaw!(node);
	const withoutPrefix = node.raw;
	node.innerPrefix = ending;
	descriptor.rebuildRaw!(node);

	// A rebuild that ignores innerPrefix leaves the field inert, which is a non-wrapping kind.
	const peels =
		node.raw !== withoutPrefix &&
		findFirstOfKind(parse(node.raw), kind)?.children?.length === expected;
	assertIs(
		peels,
		descriptor.bodyWrap?.afterOpenerLine === true,
		`${kind} container.bodyWrap.afterOpenerLine agrees with what its parse does with a blank ` +
			`line against the opener`
	);
}
