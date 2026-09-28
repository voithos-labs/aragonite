/**
 * The container conformance kit, published at `@voithos-labs/aragonite/testing`. Register your
 * kind, then run the kit with fixtures and a coverage table saying, per invariant, whether the cell
 * asserts or is excused; a thin excuse fails the run. What each cell expects:
 * `docs/guide/plugin-testing.md` § The container checkup.
 */

import type { ContainerEditActions, FocusActions } from '../action-contracts';
import type { AnyBlockKind, CstNode } from '../core/nodes';
import { documentLineEnding, splitLines, trailingLineEnding } from '../core/lines';
import { parse } from '../core/parser';
import { ancestorsOf } from '../core/paths';
import { createContainerEditActions } from '../editor-actions/container-edit';
import { createUndoController } from '../editor-actions/commit/undo-controller';
import {
	createStandardNestedActions,
	type NestedActionsBundle
} from '../editor-actions/nested/nested-actions';
import { createNestedFocus } from '../editor-actions/nested/nested-focus';
import {
	firstChildUnwrapStrategies,
	middleChildUnwrapStrategies
} from '../editor-actions/unwrap-strategies';
import type { EditEvent } from '../editor-events';
import { isDirectiveKind } from '../core/directive/registry';
import { defaultGrammarView, isBlockOpenerRegistered } from '../schema/block-openers';
import { kitReading } from './kit-reading';
import {
	getBlockKindDescriptor,
	isGridDescriptor,
	type BlockKindDescriptor
} from '../schema/block-kind-descriptor';
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
	assertIndices,
	assertIs,
	assertRebuildIsParseCanonical,
	assertReasonDocumented,
	fail,
	findFirstOfKind,
	nodeAtPath,
	pathPassesThroughKind,
	runCells,
	subjectNode,
	subjectPath,
	type CellReport,
	type ConformanceCoverage,
	type KitCell
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
	/** Required when `localIndex` asserts on a strip or opaque kind. */
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

/** The built-in profiles' hooks for the ops only a built-in kind's own context can drive (a table
 *  column insert, a list indent). Internal: no published API can perform either op. */
export interface BuiltinContainerProfile extends ContainerConformanceProfile {
	drivers?: { gridLocalIndex?: () => Promise<void>; multiScope?: () => Promise<void> };
}

// ── Report ───────────────────────────────────────────────────────────────────

export type ConformanceCell =
	'localIndex' | 'ancestry' | 'multiScope' | 'focusBubble' | 'terminatorCollision' | 'declarations';

export interface ContainerConformanceReport {
	kind: AnyBlockKind;
	cells: CellReport<ConformanceCell>[];
}

// ── Cell manifest ────────────────────────────────────────────────────────────

export interface ContainerCellContext {
	kind: AnyBlockKind;
	profile: BuiltinContainerProfile;
}

/** The kit's cells as data, so {@link runContainerConformance} and the built-in sweep run the
 *  same set and a new cell reaches both. `declarations` declares no coverage: it always runs. */
export const CONTAINER_CONFORMANCE_CELLS: readonly KitCell<
	ConformanceCell,
	ContainerCellContext
>[] = [
	{
		cell: 'localIndex',
		coverage: ({ profile }) => profile.localIndex,
		run: ({ kind, profile }) =>
			isGridDescriptor(getBlockKindDescriptor(kind))
				? driverOf(kind, profile, 'gridLocalIndex', 'a grid op')()
				: checkStripLocalIndexAddressing(kind, profile)
	},
	{
		cell: 'ancestry',
		coverage: ({ profile }) => profile.ancestry,
		run: ({ kind, profile }) => checkInnermostFirstAncestry(kind, profile)
	},
	{
		cell: 'multiScope',
		coverage: ({ profile }) => profile.multiScope,
		run: ({ kind, profile }) => driverOf(kind, profile, 'multiScope', 'an op spanning two scopes')()
	},
	{
		cell: 'focusBubble',
		coverage: ({ profile }) => profile.focusBubble,
		run: ({ kind, profile }) => checkFocusBubbleTermination(kind, profile)
	},
	{
		cell: 'terminatorCollision',
		coverage: ({ profile }) => profile.terminatorCollision,
		run: ({ kind, profile }) => checkTerminatorCollision(kind, profile),
		falsify: ({ kind }) => refuseExcusedCollision(kind)
	},
	{
		cell: 'declarations',
		run: ({ kind, profile }) => checkDeclarationSanity(kind, profile)
	}
];

/**
 * A profile must assert at least one cell it declares. `declarations` doesn't count: it asserts
 * for every kind, so counting it would let a profile that excuses everything pass.
 */
export function assertProfileCoverageFloor(
	kind: AnyBlockKind,
	profile: ContainerConformanceProfile
): void {
	const asserts = CONTAINER_CONFORMANCE_CELLS.filter(
		(c) => c.coverage?.({ kind, profile }).mode === 'assert'
	);
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
	const earlier: string[] = [];
	try {
		assertProfileCoverageFloor(kind, profile);
	} catch (error) {
		earlier.push(`coverageFloor: ${(error as Error).message}`);
	}
	const cells = await runCells(
		CONTAINER_CONFORMANCE_CELLS,
		// A published profile never supplies drivers: no published API can perform their ops.
		{ kind, profile: { ...profile, drivers: undefined } },
		{ subject: kind, heading: `container conformance failed for "${kind}"` },
		earlier
	);
	return { kind, cells };
}

// ── (a) local-index addressing ───────────────────────────────────────────────

function driverOf(
	kind: AnyBlockKind,
	profile: BuiltinContainerProfile,
	driver: 'gridLocalIndex' | 'multiScope',
	op: string
): () => Promise<void> {
	const run = profile.drivers?.[driver];
	if (run) return run;
	const cell = driver === 'gridLocalIndex' ? 'localIndex' : 'multiScope';
	fail(
		`"${kind}" asserts ${cell}, but the kit drives ${op} only for the built-in kinds that own ` +
			`one, so declare it boundary (or exempt, when the kind owns no such op)`
	);
}

/** Asserts the addressed child is the one removed and the emitted path is the chain of local
 *  indices; the fixture avoids chain [0,0] child 0, where local and global indices coincide. */
export async function checkStripLocalIndexAddressing(
	kind: AnyBlockKind,
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
	const kindNode = subjectNode(doc, kind, containerChain, 'localIndexFixture');
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

	assert(kindNode.children!.length > 1, 'kind node has ≥2 children to target a non-first one');
	const targetMarker = kindNode.children![targetChild].raw;

	const seen: EditEvent[] = [];
	events.on('edit', (e) => seen.push(e));

	await parentBundle!.blockEdit.deleteBlock(targetChild);

	// The commit replaced the ancestor nodes, so resolve again through the live document.
	const liveKind = subjectNode(doc, kind, containerChain, 'the document after the delete');
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

	// Outermost-first: each ancestor rebuilt before its descendants are fresh.
	for (const ancestor of ancestorsOf(doc, leafPath)) rebuildContainerRawIfContainer(ancestor);

	return !root.raw.includes(marker);
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

	const innerNode = subjectNode(parse(source), kind, 'first', 'focusSource');
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
	const node = subjectNode(doc, kind, [0], 'terminatorCollisionFixture');

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

/** An opaque container wraps its body between its own marker lines, so a body line can reproduce
 *  its closer whatever it declares; a declared `bodyWrite` is tested on any contract. */
function refuseExcusedCollision(kind: AnyBlockKind): void {
	const descriptor = getBlockKindDescriptor(kind);
	if (descriptor.containerContract !== 'opaque' && !descriptor.bodyWrite) return;
	fail(
		`${kind} ${descriptor.bodyWrite ? 'declares container.bodyWrite' : 'is an opaque container'}, ` +
			`and a body line reproducing its terminator truncates it, so assert terminatorCollision ` +
			`with a fixture whose body does`
	);
}

// ── (e) declaration sanity ───────────────────────────────────────────────────

/** Holds the kind to its declarations: an `unwrapRole` names implemented strategies, which the
 *  nested dispatcher indexes unguarded. */
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
	const node = subjectNode(parse(profile.deepNesting.source), kind, 'first', 'deepNesting');
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
	const node = subjectNode(doc, kind, 'first', `${kind} conformanceFixture`);
	assert(node.children?.length, `${kind} conformanceFixture opens a "${kind}" with a body child`);

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
	if (isGridDescriptor(descriptor)) return;
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
	const path = subjectPath(doc, kind, 'first', `${kind} conformanceFixture`);
	assert(
		!opensAtTop || path.length === 1,
		`${kind} conformanceFixture must open a "${kind}" at the top level — the bodyWrap probe ` +
			`rebuilds that node and reparses its bytes as a document of their own`
	);
	const node = nodeAtPath(doc, path);
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
