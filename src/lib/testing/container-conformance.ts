/**
 * The container conformance kit, published at `@voithos-labs/aragonite/testing`. Register your
 * kind, then run the kit with fixtures and a coverage table saying, per invariant, whether the cell
 * asserts or is excused; a thin excuse fails the run. What each cell expects:
 * `docs/guide/plugin-testing.md` § The container checkup.
 */

import type { ContainerEditActions, FocusActions } from '../action-contracts';
import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import { documentLineEnding, splitLines, trailingLineEnding } from '../core/lines';
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
import { defaultGrammarView, isBlockOpenerRegistered } from '../schema/block-openers';
import { kitReading } from './kit-reading';
import { getBlockKindDescriptor, type BlockKindDescriptor } from '../schema/block-kind-descriptor';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import { createSharingState } from '../tree-operations/sharing';
import { rebuildUnsharedAncestry } from '../tree-operations/chain-rebuild';
import { assertParseConverged } from './parse-convergence';
import { mountBlockListState } from './headless-block-list.svelte';
import {
	createHeadlessActions,
	recordingFocus,
	stubBlockEdit,
	stubCaretMemory
} from './headless-actions';
import {
	assert,
	assertExemptionDocumented,
	assertIndices,
	assertIs,
	assertRebuildIsParseCanonical,
	assertReasonDocumented,
	fail,
	findFirstOfKind,
	firstChildOfKind,
	nodeAtPath,
	pathPassesThroughKind,
	type ConformanceCoverage
} from './conformance-core';

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * `containerChain` runs from the document root down to and including the kind under test. Its last
 * container has `targetChild` edited, so pick a child that is not the first, or a chain position
 * that is not zero, or the check proves nothing (`checkStripLocalIndexAddressing`).
 */
export interface LocalIndexFixture {
	source: string;
	containerChain: number[];
	targetChild: number;
}

/**
 * `source` parses to a document whose first top-level block is the kind under test. `bodyRaw`
 * replaces that node's last child and has to contain a line that reproduces the container's
 * terminator (a bare `:::` for a colon fence, a `</details>` line for an HTML close tag).
 */
export interface TerminatorCollisionFixture {
	source: string;
	bodyRaw: string;
	/** Required when the fixture node parses childless (its body lives in metadata): puts the
	 *  kit's `bodyWrite`-normalized bytes wherever that container keeps its body. */
	writeBody?: (node: CstNode, body: string) => void;
}

export interface ContainerConformanceProfile {
	/** A nesting where this kind is an intermediate ancestor of the doc-rooted `leafPath`. */
	deepNesting: { source: string; leafPath: number[] };
	/** Required when `localIndex` asserts (strip/opaque kinds; grid has its own path). */
	localIndexFixture?: LocalIndexFixture;
	/** Required when `focusBubble` asserts: a source whose tree holds a node of the kind with ≥1 child. */
	focusSource?: string;
	/** Required when `terminatorCollision` asserts. `bodyRaw` goes through the kind's
	 *  `bodyWrite` rule, so it names the bytes a user types, not what reaches the tree. */
	terminatorCollisionFixture?: TerminatorCollisionFixture;
	/** Why no behavioral cell asserts: required when the profile excuses them all, and rejected
	 *  when any cell asserts. */
	wholeProfileExemption?: string;
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

// ── Cell manifest ────────────────────────────────────────────────────────────

export interface ContainerConformanceCell {
	cell: ConformanceCell;
	/** The profile's declaration for this cell; `declarations` answers unconditionally. */
	coverage: (profile: ContainerConformanceProfile) => ConformanceCoverage;
	run: (kind: AnyBlockKind, profile: ContainerConformanceProfile) => void | Promise<void>;
}

/** The kit's cells as data, so {@link runContainerConformance} and the built-in sweep run the
 *  same set and a new cell reaches both. */
export const CONTAINER_CONFORMANCE_CELLS: readonly ContainerConformanceCell[] = [
	{
		cell: 'localIndex',
		coverage: (profile) => profile.localIndex,
		run: (kind, profile) =>
			getBlockKindDescriptor(kind).containerContract === 'grid'
				? checkGridLocalIndexAddressing()
				: checkStripLocalIndexAddressing(profile)
	},
	{ cell: 'ancestry', coverage: (profile) => profile.ancestry, run: checkInnermostFirstAncestry },
	{
		cell: 'multiScope',
		coverage: (profile) => profile.multiScope,
		run: checkOneUndoPerMultiScope
	},
	{
		cell: 'focusBubble',
		coverage: (profile) => profile.focusBubble,
		run: checkFocusBubbleTermination
	},
	{
		cell: 'terminatorCollision',
		coverage: (profile) => profile.terminatorCollision,
		run: checkTerminatorCollision
	},
	{ cell: 'declarations', coverage: () => ({ mode: 'assert' }), run: checkDeclarationSanity }
];

/** The cells whose coverage a profile declares. `declarations` is the kit's, not the author's. */
const BEHAVIORAL_CELLS = CONTAINER_CONFORMANCE_CELLS.filter((c) => c.cell !== 'declarations');

/**
 * A profile must assert at least one behavioral cell. `declarations` is excluded on purpose: it
 * asserts for every kind, so counting it would let a profile that excuses everything pass.
 */
export function assertProfileCoverageFloor(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): void {
	const asserts = BEHAVIORAL_CELLS.filter((c) => c.coverage(profile).mode === 'assert');
	if (asserts.length > 0) {
		assert(
			profile.wholeProfileExemption === undefined,
			`${kind} declares a wholeProfileExemption while ${asserts.length} behavioral cell(s) assert`
		);
		return;
	}
	assert(
		profile.wholeProfileExemption !== undefined,
		`${kind} excuses every behavioral cell, so the kit asserts nothing about it — declare ` +
			`wholeProfileExemption with the reason the kind is covered elsewhere, or assert a cell`
	);
	assertReasonDocumented(profile.wholeProfileExemption, `${kind} wholeProfileExemption`);
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
	const cells: ConformanceCellReport[] = [];
	const failures: string[] = [];

	try {
		assertProfileCoverageFloor(kind, profile);
	} catch (error) {
		failures.push(`coverageFloor: ${(error as Error).message}`);
	}

	for (const { cell, coverage: read, run } of CONTAINER_CONFORMANCE_CELLS) {
		const coverage = read(profile);
		try {
			if (coverage.mode === 'assert') {
				await run(kind, profile);
				cells.push({ cell, status: 'asserted' });
			} else {
				assertExemptionDocumented(coverage, `${kind} ${cell}`);
				cells.push({ cell, status: coverage.mode, reason: coverage.reason });
			}
		} catch (error) {
			failures.push(`${cell}: ${(error as Error).message}`);
		}
	}

	if (failures.length > 0) {
		throw new Error(`container conformance failed for "${kind}":\n  - ${failures.join('\n  - ')}`);
	}
	return { kind, cells };
}

// ── (a) local-index addressing ───────────────────────────────────────────────

/** Asserts the addressed child is the one removed and the emitted path is the chain of local
 *  indices; the fixture avoids chain [0,0] child 0, where local and global indices coincide. */
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
			caretMemory: stubCaretMemory(),
			reading: kitReading(),
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

	// The commit replaced the ancestor nodes, so resolve again through the live document.
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

	// Compared against a fresh parse, not byte round-trip, which is trivially true here: this
	// catches an op that left the container's raw stale or its shape different.
	assertParseConverged(doc, 'doc converges after a local-index op');
}

/** A table column op addresses cells by (rowIdx, colIdx) and emits the table's own path; the
 *  leading paragraph keeps the table off index 0, so a global index would differ. */
export async function checkGridLocalIndexAddressing(): Promise<void> {
	const parsed = parse('lead para\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n');
	assertIs(parsed.children[1].kind, 'table', 'table at non-zero doc index');
	const { ctx, deps, doc, events } = mountTableMutations(parsed.children, 1);

	const seen: EditEvent[] = [];
	events.on('edit', (e) => seen.push(e));

	// Pinning the new cell's position by content is what proves cells are addressed by
	// local column index rather than appended at the end.
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

	// A column op that left the table's raw stale, or a row the delimiter row does not match,
	// fails here.
	assertParseConverged(doc, 'doc converges after a grid column op');
}

/** The table-mutations mount both grid cells share: headless deps, controller, row states, ctx. */
function mountTableMutations(children: CstNode[], tableIndex: number) {
	const table = children[tableIndex];
	const { deps, doc, events } = createHeadlessActions(children);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	const rowsState = mountBlockListState(() => table);
	// commitColumnEdit resolves each row through expectStateForNode, so register them.
	for (const row of table.children!) mountBlockListState(() => row);

	const ctx = createTableMutationsContext({
		get node() {
			return table;
		},
		get myPath() {
			return [tableIndex];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return { rowIdx: 0, colIdx: 0 };
		},
		parentContainerEdit: rootContainerEdit,
		controller,
		reading: deps.reading,
		focusCell: () => {}
	});
	return { ctx, deps, doc, events };
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

	// Fresh sharing state, no merge callback and the global grammar: the check covers only raw
	// propagation, and the kit owns no ids to reconcile a splice with.
	rebuildUnsharedAncestry(doc, leafPath, createSharingState(), null, defaultGrammarView);

	assert(root.raw.includes(marker), `root raw reflects the deep leaf edit through "${kind}"`);
}

/** Shows the ancestry check can fail: an outer-to-inner rebuild leaves a strip or opaque root
 *  stale. False for a grid, which re-derives its whole subtree and so excuses ancestry. */
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
	// indentItem reaches into prevItem (item 0) through expectStateForNode, so register each item.
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
		getLineEnding: () => documentLineEnding(deps.doc),
		state: listState,
		parentBlockEdit: stubBlockEdit(),
		parentFocus: recordingFocus(),
		parentListContext: undefined,
		controller,
		reading: deps.reading
	});

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.indentItem(1);
	const after = deps.undoManager.getStacks().undo.length;

	assertIs(after - before, 1, 'list indentItem (multi-scope) pushes exactly ONE undo entry');
	assertIs(deps.doc.children[0].children!.length, 1, 'item 1 was indented out of the outer list');
	assertParseConverged(deps.doc, 'doc converges after a multi-scope strip op');
}

async function checkTableColumnOneUndo(): Promise<void> {
	const table = firstChildOfKind('| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n', 'table');
	const { ctx, deps } = mountTableMutations([table], 0);

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.insertColumnRight(0);
	const after = deps.undoManager.getStacks().undo.length;

	assertIs(after - before, 1, 'table insertColumn (multi-scope) pushes exactly ONE undo entry');
	assertParseConverged(deps.doc, 'doc converges after a multi-scope grid op');
}

// ── (d) focus-bubble termination at root ─────────────────────────────────────

/** Bubbles an out-of-range ArrowUp through the kind's own focus bundle, under a blockquote at its
 *  top edge, and asserts the root sees it once, catching wiring that re-enters or escapes twice. */
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

	const focusRung = (node: CstNode, index: number, focus: FocusActions) =>
		createNestedFocus(
			mountBlockListState(() => node),
			{
				index,
				get node() {
					return node;
				},
				path: [index],
				caretMemory: stubCaretMemory(),
				reading: kitReading(),
				parent: { blockEdit: stubBlockEdit(), focus, containerEdit: {} as never }
			}
		);

	// At its own top edge, so moveFocus(-1) must delegate to root rather than re-enter.
	const outerNode = parse('> a\n>\n> b\n').children[0];
	const outerFocus = focusRung(outerNode, 3, rootFocus);
	const innerFocus = focusRung(innerNode, 0, outerFocus);

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

/** Writes a terminator-shaped body line through `bodyWrite`, as the commit path does, and requires
 *  the tree to match a fresh parse, since byte round-trip holds even through a collision. */
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

	const bodyWrite = getBlockKindDescriptor(kind).bodyWrite;
	const ctx = { node, mode: 'literal', lineEnding: documentLineEnding(doc) } as const;
	const body = bodyWrite ? bodyWrite.normalize(fixture.bodyRaw, ctx) : fixture.bodyRaw;
	const children = node.children ?? [];
	const before = node.raw;
	if (children.length > 0) {
		children[children.length - 1].raw = body;
	} else {
		if (!fixture.writeBody) {
			fail(
				`"${kind}" parses childless, so there is no last child to overwrite — carry a ` +
					`writeBody seating the body where this container keeps it (metadata, typically)`
			);
		}
		fixture.writeBody(node, body);
	}
	rebuildContainerRawIfContainer(node);

	// Without this the cell passes on a container the write never reached, which is how a body
	// written to the wrong place would look like it survived a collision it never saw.
	assert(node.raw !== before, `the fixture body reached "${kind}"'s own bytes`);
	assertParseConverged(doc, `${kind} survives a body line reproducing its terminator`);
}

// ── (e) declaration sanity ───────────────────────────────────────────────────

/** Holds the kind to its declarations: an `unwrapRole` names implemented strategies, which the
 *  nested dispatcher indexes unguarded, and an opaque or `bodyWrite` kind asserts collision. */
export function checkDeclarationSanity(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): void {
	const descriptor = getBlockKindDescriptor(kind);

	// An opaque container wraps its body between its own marker lines, so a body line can
	// reproduce its closer whatever it declares; a declared `bodyWrite` is tested on any contract.
	const owesCollisionAnswer = descriptor.containerContract === 'opaque' || !!descriptor.bodyWrite;
	if (owesCollisionAnswer && profile.terminatorCollision.mode !== 'assert') {
		fail(
			`${kind} ${descriptor.bodyWrite ? 'declares container.bodyWrite' : 'is an opaque container'} ` +
				`but its profile marks terminatorCollision "${profile.terminatorCollision.mode}" — a body ` +
				`line reproducing the terminator truncates the container, so assert the cell with a ` +
				`fixture whose body does`
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
	assertHintedRebuildMatchesFull(kind, descriptor, node);
	assertBodyWrapMatchesParse(kind, descriptor);
	assertContentStartSpaceIsRebuilt(kind, descriptor);
}

/** `rebuildRaw`'s changed-child hint is a shortcut, never a different answer: the same children
 *  rebuilt with and without it give the same bytes. */
function assertHintedRebuildMatchesFull(
	kind: AnyBlockKind,
	descriptor: BlockKindDescriptor,
	node: CstNode
): void {
	const children = node.children;
	if (!children?.length) return;
	const index = children.length - 1;
	const previousRaw = children[index].raw;
	// Doubling keeps the child's own line shape, and with one operand the cross-node join check
	// still reads it as the kind re-emitting its own bytes.
	children[index].raw = previousRaw.repeat(2);

	descriptor.rebuildRaw!(node, { index, previousRaw });
	const hinted = node.raw;
	descriptor.rebuildRaw!(node);
	assertIs(
		hinted,
		node.raw,
		`${kind} rebuildRaw writes the same bytes for a changed-child hint as for a full rebuild`
	);
}

/** The content these checks write into a body child, distinctive enough that no fixture line
 *  ends in it by accident. */
const CONTENT_START_PROBE = 'probe';

/** `container.contentStartSpace` swallows the user's space, so the rebuild must write it back on a
 *  content line or the keystroke is lost. */
function assertContentStartSpaceIsRebuilt(
	kind: AnyBlockKind,
	descriptor: BlockKindDescriptor
): void {
	if (descriptor.contentStartSpace !== 'complete-marker') return;
	const fixture = descriptor.conformanceFixture;
	if (fixture === undefined) {
		fail(`${kind} declares container.contentStartSpace but carries no conformanceFixture to probe`);
	}
	const doc = parse(fixture);
	const node = doc.children.find((child) => child.kind === kind);
	assert(node?.children?.length, `${kind} conformanceFixture opens a "${kind}" with a body child`);

	// The last child, so a reserved title child (a heading, a summary) stays put: its own line
	// already carries the opener's space, and rebuilding over it would test the wrong line.
	const last = node.children[node.children.length - 1];
	last.raw = CONTENT_START_PROBE + trailingLineEnding(last.raw, documentLineEnding(doc));
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

/** `container.bodyWrap` is tested, not trusted: `clearRedundantSeparator` reads it to place a freed
 *  blank line, and a kind whose parse disagrees loses the start of its body on reload. */
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
	// A kind with no recognizer of its own (listItem) is tested where the fixture nests it; a
	// directive kind's recognizer is the shared `:::`, which the opener registry does not list.
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
	// A container whose body lives in metadata parses childless, so it has no wrap to test and
	// must declare none: the blank-line fix-up would trust a wrap the parse never performs.
	if (!node.children?.length) {
		assertIs(
			descriptor.bodyWrap?.afterOpenerLine,
			undefined,
			`${kind} parses childless (its body lives in metadata), so a blank line against its ` +
				`opener belongs to that body — drop the container.bodyWrap declaration`
		);
		return;
	}

	const expected = node.children.length;
	const ending = trailingLineEnding(node.raw, documentLineEnding(doc));
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
