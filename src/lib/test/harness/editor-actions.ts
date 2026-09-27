// Shared mocks for editor-actions and selection unit tests: the published headless stubs
// (`testing/headless-actions.ts`) with every member a `vi.fn`, so a test can assert on calls.

import { vi, type Mocked } from 'vitest';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	ListContext
} from '$lib/action-contracts';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode, Document } from '$lib/core/nodes';
import { documentLineEnding } from '$lib/core/lines';
import { asEditorX } from '$lib/cursor/coordinate-spaces';
import { createCaretMemory, type CaretMemory } from '$lib/cursor/caret-memory';
import type { PendingMarks } from '$lib/cursor/pending-marks';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import type { EditorActionsDeps, UndoController } from '$lib/editor-actions/deps';
import {
	landCaretInScope,
	type CommitScope,
	type ScopeCommitArgs
} from '$lib/editor-actions/block-edit-scope';
import { asDocPath } from '$lib/selection/path-math';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import type { ContainerBlockComponentDeps } from '$lib/editor-actions/container-block-component';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import type { ChildList } from '$lib/reactivity/child-list';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';
import type { PasteDispatchContext } from '$lib/tree-operations/paste/dispatch';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createListContext } from '$lib/editor-actions/list-context';
import { createListOverrides } from '$lib/editor-actions/list-overrides';
import {
	createStandardNestedActions,
	type NestedActionsBundle,
	type NestedActionsDeps,
	type NestedActionsInput,
	type NestedActionsOverrideFactory
} from '$lib/editor-actions/nested/nested-actions';
import type { PresentationMode } from '$lib/presentation-mode';
import type { WriteMode } from '$lib/schema/block-kind-descriptor';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import type { GrammarView } from '$lib/schema/block-openers';
import { fixtureReading } from './fixture-grammar';
import { parse } from '$lib/core/parser';
import type { EditEvent, EditorEvents } from '$lib/editor-events';
import { mountBlockListState } from '$lib/testing/headless-block-list.svelte';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import { getStateForNode, expectStateForNode } from '$lib/reactivity/state-registry';
import { createSharingState } from '$lib/tree-operations/sharing';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { GapStopScope } from '$lib/selection/gap-caret';
import {
	createHeadlessActions,
	stubBlockComponent,
	stubBlockEdit,
	stubCaretMemory,
	type HeadlessActions,
	type HeadlessActionsOptions
} from '$lib/testing/headless-actions';

// ── CST node factory ─────────────────────────────────────────────────────────

/** A minimal leaf CST node for editor-action and invariant unit fixtures. */
export function makeNode(kind: string, raw: string, metadata?: Record<string, unknown>): CstNode {
	return { kind, leadingTrivia: '', raw, ...(metadata ? { metadata } : {}) } as CstNode;
}

/** The first parsed block of `raw`, the leaf shape the block-edit-core suites drive. */
export function parseLeaf(raw: string): CstNode {
	return parse(raw).children[0];
}

// ── Spied stubs ──────────────────────────────────────────────────────────────

/** `stub` with every method wrapped in `vi.fn`, keeping its behavior: the member list lives only
 *  in the published stub, so a new member fails `npm run check` in one place. */
export function spyEvery<T extends object>(stub: T): Mocked<T> {
	const spied = { ...stub } as Record<string, unknown>;
	for (const [key, value] of Object.entries(spied)) {
		if (typeof value === 'function') spied[key] = vi.fn(value as (...args: unknown[]) => unknown);
	}
	return spied as Mocked<T>;
}

export { stubBlockComponent };

/** A gap scope over `source`: the kinds it parses to are what declare the eligible edges. */
export function makeGapScope(source: string): GapStopScope {
	const doc = parse(source);
	return { getDoc: () => doc, selection: createSelectionState() };
}

/** An inert gap scope, for the traversals that assert the caret lands outside a gap. */
export function makeEmptyGapScope(): GapStopScope {
	return makeGapScope('');
}

/** A caret memory whose column reads `x`, every method a `vi.fn`; its marks are real (below). */
export function makeCaretMemory(x: number | null = null): Mocked<CaretMemory> {
	const column = x === null ? null : asEditorX(x);
	return spyEvery({ ...stubCaretMemory(), column: () => column, pendingMarks: makePendingMarks() });
}

/** The real marks, armed with `kinds`: a stub would hide the one property every consumer
 *  depends on, that a set is spent exactly once. */
export function makePendingMarks(...kinds: InlineMarkKind[]): PendingMarks {
	const marks = createCaretMemory().pendingMarks;
	for (const kind of kinds) marks.toggle(kind);
	return marks;
}

// ── BlockListState ───────────────────────────────────────────────────────────

/** The production state over `getNode` with every child outside the render window, so no ref
 *  answers. `getNode` reads the live node, because a commit copies its ancestors. */
export function makeBlockListState(getNode: () => CstNode, ids?: string[]): BlockListState {
	return mountBlockListState(getNode, { ids, refAt: () => undefined });
}

// ── CommitScope stub ─────────────────────────────────────────────────────────

/** Runs the real mutate against a live children array, recording commits. A keystroke's
 *  in-place route writes nothing here: the suites over this stub drive the commit routes. */
export function makeCommitScopeStub(
	children: CstNode[],
	opts: { refs?: (BlockComponent | undefined)[]; collapse?: boolean; owner?: CstNode } = {}
): { scope: CommitScope; commits: ScopeCommitArgs[]; children: CstNode[] } {
	const refs = opts.refs ?? [];
	const commits: ScopeCommitArgs[] = [];
	const sharing = createSharingState();
	const lineEnding = () =>
		documentLineEnding({ kind: 'document', prefix: '', children, suffix: '' });
	const scope: CommitScope = {
		path: asDocPath([]),
		reading: fixtureReading(),
		caretMemory: stubCaretMemory(),
		children: () => children,
		target: () => ({ children, owner: opts.owner, lineEnding: lineEnding() }),
		idAt: (i) => `block-${i}`,
		refAt: (i) => refs[i],
		// No render window here: every ref counts as mounted.
		reveal: async (i, path) =>
			(path.length === 0 ? refs[i] : refs[i]?.getBlockComponentByPath?.([...path])) ?? null,
		collapseEmptyReplaceToDelete: opts.collapse ?? true,
		async commit(args) {
			commits.push(args);
			args.mutate({
				body: { children, owner: opts.owner, lineEnding: lineEnding() },
				sharing,
				reading: fixtureReading(),
				unshareChild: (i) => children[i]
			});
			await args.afterTick?.();
			return true;
		},
		typeIn: (_i, _offset, work) => work(),
		writeInPlace: () => ({ wrote: false }),
		at: (i, subPath, offset) => ({ path: docPathFrom([i, ...subPath]), offset }),
		land: (pos) => landCaretInScope(scope, pos.path[0], pos.path.slice(1), pos.offset)
	};
	return { scope, commits, children };
}

// ── Container-shim deps ──────────────────────────────────────────────────────

function paragraphListNode(childCount: number): CstNode {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: { ordered: false },
		children: Array.from({ length: childCount }, () => ({
			kind: 'paragraph' as const,
			leadingTrivia: '',
			raw: 'text\n'
		}))
	};
}

/** A child list over `refs` with no render window: every ref counts as mounted. */
export function makeShimChildList(
	refs: (BlockComponent | undefined)[],
	over: Partial<ChildList> = {}
): ChildList {
	return {
		count: () => refs.length,
		refs: refSlotsOver(refs),
		windowing: { revealChild: async () => {}, isInWindow: () => true },
		...over
	};
}

/** The members every container shim repeats; `over` adds a test's own. Copied by property
 *  descriptor, so a getter in `over` stays live instead of freezing at call time. */
export function makeShimDeps(
	refs: (BlockComponent | undefined)[],
	over: Partial<ContainerBlockComponentDeps> = {}
): ContainerBlockComponentDeps {
	const deps: ContainerBlockComponentDeps = {
		selection: createSelectionState(),
		reading: fixtureReading(),
		get innerBlockRefs() {
			return refs;
		},
		childList: makeShimChildList(refs),
		get node() {
			return paragraphListNode(refs.length);
		}
	};
	return Object.defineProperties(deps, Object.getOwnPropertyDescriptors(over));
}

// ── Action-bundle stubs ──────────────────────────────────────────────────────

export function makeStubBlockEdit(): Mocked<BlockEditActions> {
	return spyEvery(stubBlockEdit());
}

// revealPath resolves null: these consumers assert on moveFocus, not on the
// resolved component, and don't model render-window mounting.
export function makeStubFocus(): FocusActions {
	return { moveFocus: vi.fn(), revealPath: async () => null, tryGapStop: () => false };
}

export function makeStubContainerEdit(): ContainerEditActions {
	return {
		commitContainer: vi.fn(),
		lineEnding: () => '\n',
		typeInLeaf: vi.fn((_path, _offset, _key, work) => work()),
		writeLeafInPlace: vi.fn(() => ({ wrote: false as const }))
	};
}

export function makeStubController(): UndoController & PasteCommitCoordinator {
	return {
		sharing: createSharingState(),
		pushUndoSnapshotDebounced: vi.fn(),
		flushDebouncedCheckpoint: vi.fn(),
		// Runs the write: the batch breaks are the stubbed half, the bytes are not.
		isolateUndoEntry: vi.fn((write: () => void) => write()),
		undoStep: vi.fn(async (_seed: unknown, run: () => Promise<unknown>) => void (await run())),
		joinTypingBatch: vi.fn((write: () => unknown) => write()),
		endUndoStep: vi.fn(),
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		resolveState: getStateForNode,
		expectState: expectStateForNode,
		focusByPath: vi.fn()
	} as unknown as UndoController & PasteCommitCoordinator;
}

// ── Paste-dispatch stubs ─────────────────────────────────────────────────────

/** The registered state the paste router resolves for a container scope, every child unmounted. */
export function registerStubBlockListState(node: CstNode): void {
	makeBlockListState(() => node);
}

/** The editor's paste coordinator over a real undo controller on `source`. Read results through
 *  the returned `doc`: a commit replaces the nodes it touches rather than writing into them. */
export function makePasteCommit(source: string | Document): {
	doc: Document;
	controller: PasteCommitCoordinator;
} {
	const { deps } = makeEditorActionsDeps(source);
	return {
		doc: deps.doc,
		controller: createPasteCoordinator(createUndoController(deps), deps.revealPath)
	};
}

// ── EditorActionsDeps factory ────────────────────────────────────────────────

export interface EditorActionsHarness extends HeadlessActions {
	/** A plain counter standing in for the editor's content version, so a test can ask whether the
	 *  function it drove announced its write. */
	contentVersion: () => number;
}

/** A paste context for an editor with no `plugins` or `syntax` prop: every installed plugin and
 *  the fixture reading, unless the fixture names its own. */
export function pasteContext(
	fields: Omit<PasteDispatchContext, 'reading' | 'activePlugins'> &
		Partial<Pick<PasteDispatchContext, 'reading' | 'activePlugins'>>
): PasteDispatchContext {
	return { reading: fixtureReading(), activePlugins: everyInstalledPlugin, ...fields };
}

/** The published headless deps with spied collaborators and a content-version counter. */
export function makeEditorActionsDeps(
	source: string | CstNode[] | Document,
	options: Omit<HeadlessActionsOptions, 'spy' | 'bumpContentVersion'> = {}
): EditorActionsHarness {
	let contentVersion = 0;
	const headless = createHeadlessActions(source, {
		...options,
		spy: spyEvery,
		bumpContentVersion: () => {
			contentVersion++;
		}
	});
	return { ...headless, contentVersion: () => contentVersion };
}

// ── Top-level action-bundle harness ──────────────────────────────────────────

export interface TopHarness extends EditorActionsHarness {
	controller: UndoController;
	actions: BlockEditActions;
	/** Every emitted edit event, in order. */
	edits: EditEvent[];
}

/** The top-level counterpart of `makeNestedHarness`: deps, controller and block-edit actions. */
export function makeTopHarness(
	input: string | CstNode[] | Document,
	options: Parameters<typeof makeEditorActionsDeps>[1] = {}
): TopHarness {
	const source = typeof input === 'string' ? parse(input) : input;
	const harness = makeEditorActionsDeps(source, options);
	const controller = createUndoController(harness.deps);
	const actions = createBlockEditActions(harness.deps, controller);
	const edits: EditEvent[] = [];
	harness.events.on('edit', (e) => edits.push(e));
	return { ...harness, controller, actions, edits };
}

// ── ListContext harness ──────────────────────────────────────────────────────

export interface ListContextHarness {
	listContext: ListContext;
	state: BlockListState;
	getNode: () => CstNode;
	controller: UndoController;
}

export interface ListContextAtOptions {
	ids?: string[];
	controller?: UndoController;
	parentBlockEdit?: BlockEditActions;
	parentFocus?: FocusActions;
	parentListContext?: ListContext;
}

// Owns only the list-level state + context; child-item states stay the caller's
// to register.
export function makeListContextAt(
	deps: EditorActionsDeps,
	listIndex: number,
	opts: ListContextAtOptions = {}
): ListContextHarness {
	const getNode = () => deps.doc.children[listIndex];
	const state = makeBlockListState(getNode, opts.ids);
	const controller = opts.controller ?? createUndoController(deps);
	const listContext = createListContext({
		scope: {
			get index() {
				return listIndex;
			},
			get node() {
				return getNode();
			},
			get path() {
				return [listIndex];
			}
		},
		getLineEnding: () => documentLineEnding(deps.doc),
		state,
		parentBlockEdit: opts.parentBlockEdit ?? makeStubBlockEdit(),
		parentFocus: opts.parentFocus ?? makeStubFocus(),
		parentListContext: opts.parentListContext,
		controller,
		reading: deps.reading
	});
	return { listContext, state, getNode, controller };
}

// ── Nested action-bundle harness ─────────────────────────────────────────────

export interface NestedActionsDepsInput {
	index: number;
	getNode: () => CstNode;
	path: number[];
	parent: NestedActionsDeps['parent'];
	caretMemory?: Pick<CaretMemory, 'column' | 'forget'>;
	reading?: NestedActionsDeps['reading'];
}

// Every call site routes its input through here, so the shape with the live getters is built
// once instead of re-derived per test.
export function makeNestedActionsDeps(input: NestedActionsDepsInput): NestedActionsInput {
	return {
		scope: {
			index: input.index,
			get node() {
				return input.getNode();
			},
			path: input.path
		},
		caretMemory: input.caretMemory ?? makeCaretMemory(),
		reading: input.reading ?? fixtureReading(),
		parent: input.parent
	};
}

export interface NestedHarness {
	deps: EditorActionsDeps;
	events: EditorEvents;
	controller: UndoController;
	containerEdit: ContainerEditActions;
	state: BlockListState;
	bundle: NestedActionsBundle;
	getNode: () => CstNode;
	contentVersion: () => number;
}

export interface NestedHarnessOptions {
	/** Container index within the document; defaults to the last child. */
	index?: number;
	overrides?: NestedActionsOverrideFactory;
	/** Wire the standard list-item overrides (unwrap/merge/delete) onto the bundle. */
	listOverrides?: boolean;
	grammar?: GrammarView;
	presentationMode?: PresentationMode;
	/** One caret memory for the root and the container, as the editor hands both the same one. */
	caretMemory?: CaretMemory;
}

// Full nested-container setup over `source` (parsed) or an explicit node list, on the
// production block-list state, so the container under test has a mounted container's shape.
export function makeNestedHarness(
	input: string | CstNode[] | Document,
	opts: NestedHarnessOptions = {}
): NestedHarness {
	const source = typeof input === 'string' ? parse(input) : input;
	const nodes = Array.isArray(source) ? source : source.children;
	const index = opts.index ?? nodes.length - 1;
	// One reading for the root and the container, as the editor hands both the same one.
	const reading =
		opts.grammar || opts.presentationMode
			? fixtureReading(opts.grammar ? { grammar: opts.grammar } : {}, opts.presentationMode)
			: undefined;
	const { deps, events, contentVersion } = makeEditorActionsDeps(
		source,
		reading ? { reading } : {}
	);
	if (opts.caretMemory) deps.caretMemory = opts.caretMemory;
	const controller = createUndoController(deps);
	const containerEdit = createContainerEditActions(deps, controller);
	const getNode = () => deps.doc.children[index];
	const state = makeBlockListState(getNode);
	// The editor's descent in miniature: a path into this container reaches its own refs.
	const descendingFocus = (): FocusActions => ({
		...makeStubFocus(),
		revealPath: async (path) => {
			if (path[0] !== index || path.length < 2) return deps.revealPath(path);
			const ref = state.innerBlockRefs[path[1]];
			return path.length === 2
				? (ref ?? null)
				: (ref?.getBlockComponentByPath?.(path.slice(2)) ?? null);
		}
	});
	const overrides = opts.listOverrides
		? createListOverrides({
				scope: {
					get index() {
						return index;
					},
					get node() {
						return getNode();
					},
					get path() {
						return [index];
					}
				},
				parentBlockEdit: makeStubBlockEdit()
			})
		: opts.overrides;
	const bundle = createStandardNestedActions(
		state,
		makeNestedActionsDeps({
			index,
			getNode,
			path: [index],
			reading: deps.reading,
			caretMemory: opts.caretMemory,
			parent: { blockEdit: makeStubBlockEdit(), focus: descendingFocus(), containerEdit }
		}),
		overrides
	);
	return { deps, events, controller, containerEdit, state, bundle, getNode, contentVersion };
}

/** A root focus whose `revealPath` hands back a component that records where it was focused,
 *  standing in for the editor's own descent to a mounted block. */
export function makeLandingFocus(): FocusActions & {
	landings: { path: number[]; offset: number }[];
} {
	const landings: { path: number[]; offset: number }[] = [];
	return {
		landings,
		moveFocus: vi.fn(),
		revealPath: async (path) =>
			stubBlockComponent({ focus: (offset) => landings.push({ path: [...path], offset }) }),
		tryGapStop: () => false
	};
}

/** The container at `containerPath`, at any depth, over the real root: its node is read live
 *  through the document, since a commit replaces every ancestor it copies. */
export function makeContainerHarness(source: string, containerPath: number[]) {
	const harness = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(harness.deps);
	const focus = makeLandingFocus();
	const getNode = () => nodeAt(harness.deps.doc, containerPath) as CstNode;
	const state = makeBlockListState(getNode);
	const bundle = createStandardNestedActions(
		state,
		makeNestedActionsDeps({
			index: containerPath[containerPath.length - 1],
			getNode,
			path: containerPath,
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus,
				containerEdit: createContainerEditActions(harness.deps, controller)
			}
		})
	);
	const edits: EditEvent[] = [];
	harness.events.on('edit', (e) => edits.push(e));
	return { ...harness, controller, bundle, state, getNode, focus, edits };
}

/** The action bundle of the first table's body row `row` (the first by default): the one a
 *  cell in that row writes through, over a real commit path. */
export function mountBodyRow(source: string, row = 1) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	const getNode = () => deps.doc.children[0].children![row];
	const bundle = createStandardNestedActions(
		makeBlockListState(getNode),
		makeNestedActionsDeps({
			index: row,
			getNode,
			path: [0, row],
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit: createContainerEditActions(deps, controller)
			}
		})
	);
	return { deps, blockEdit: bundle.blockEdit };
}

/** One `updateBlockContent` call as a recording stub saw it. */
export interface RecordedWrite {
	index: number;
	raw: string;
	mode: WriteMode;
	before: number | undefined;
	after: number | undefined;
}

/** An `updateBlockContent` that stores nothing: it reports each call and hands back the caret it
 *  was asked for, which is what the write returns when no rule rewrites the bytes. */
export function recordingWrite(
	record: (write: RecordedWrite) => void = () => {}
): BlockEditActions['updateBlockContent'] {
	return (index, raw, mode, before, after) => {
		record({ index, raw, mode, before, after });
		return withStoredCaret(Promise.resolve(), after ?? before ?? 0);
	};
}
