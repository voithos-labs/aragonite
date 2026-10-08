// Shared mocks for editor-actions and selection unit tests: the published headless stubs
// (`testing/headless-actions.ts`) with every member a `vi.fn`, so a test can assert on calls.

import { vi, type Mocked } from 'vitest';
import type {
	BlockEditActions,
	ContainerEditActions,
	ContentWrite,
	FocusActions,
	ListContext
} from '#lib/action-contracts.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { asEditorX } from '#lib/caret/coordinate-spaces.js';
import { createCaretMemory, type CaretMemory } from '#lib/caret/caret-memory.js';
import type { PendingMarks } from '#lib/caret/pending-marks.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';
import type { EditorActionsDeps, UndoController } from '#lib/editor-actions/deps.js';
import type { CommitScope, ScopeCommitArgs } from '#lib/editor-actions/block-edit-scope.js';
import { asDocPath } from '#lib/selection/path-math.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import type { ContainerBlockComponentDeps } from '#lib/editor-actions/container-block-component.js';
import { refSlotsOver } from '#lib/reactivity/publish-ref.svelte.js';
import { componentAt, type ChildList } from '#lib/reactivity/child-list.js';
import { caretTargetFor, survivorAfterRemoval } from '#lib/selection/caret-target.js';
import {
	delegateMoveFocus,
	type MoveFocusScope
} from '#lib/editor-actions/focus/focus-dispatch.js';
import type { PasteCommitCoordinator } from '#lib/tree-operations/paste/paste-deps.js';
import type { PasteDispatchContext } from '#lib/tree-operations/paste/dispatch.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { createContainerEditActions } from '#lib/editor-actions/container-edit.js';
import { createListContext } from '#lib/editor-actions/list-context.js';
import { createListOverrides } from '#lib/editor-actions/list-overrides.js';
import {
	createStandardNestedActions,
	type NestedActionsBundle,
	type NestedActionsDeps,
	type NestedActionsInput,
	type NestedActionsOverrideFactory
} from '#lib/editor-actions/nested/nested-actions.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { Reading } from '#lib/schema/reading.js';
import type { WriteMode } from '#lib/schema/block-kind-descriptor.js';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { fixtureReading } from './fixture-grammar';
import { parse } from '#lib/core/parser.js';
import type { EditEvent, EditorEvents } from '#lib/editor-events.js';
import { mountBlockListState } from '#lib/testing/headless-block-list.svelte.js';
import type { BlockListState } from '#lib/reactivity/block-list-state.svelte.js';
import { getStateForNode, expectStateForNode } from '#lib/reactivity/state-registry.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import {
	createInlineRangeCommit,
	type InlineRangeCommit
} from '#lib/editor-actions/inline-range-commit.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import type { GapStopScope } from '#lib/selection/gap-caret.js';
import {
	createHeadlessActions,
	stubBlockComponent,
	stubBlockEdit,
	stubCaretMemory,
	type HeadlessActions,
	type HeadlessActionsOptions,
	type RecordedLanding
} from '#lib/testing/headless-actions.js';
import { createDocumentStamps } from '#lib/editor-actions/commit/document-stamp.js';

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
	return {
		getDoc: () => doc,
		selection: createSelectionState(),
		getPresentationMode: () => 'source'
	};
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

/** The state of the table at top-level `index`, following the copy a commit puts there; once a
 *  removal takes the table, it keeps the one it was built on, as an unmounted table's state would. */
export function makeTableStateAt(getDoc: () => Document, index: number): BlockListState {
	const built = getDoc().children[index];
	return makeBlockListState(() => {
		const live = getDoc().children[index];
		return live?.kind === 'table' ? live : built;
	});
}

// ── CommitScope stub ─────────────────────────────────────────────────────────

/** Runs the real mutate against a live children array, recording commits and landing each one's
 *  caret on `refs`. The in-place keystroke route writes nothing: these suites drive commits. */
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
		stamps: createDocumentStamps(),
		caretMemory: stubCaretMemory(),
		children: () => children,
		target: () => ({ children, owner: opts.owner, lineEnding: lineEnding() }),
		idAt: (i) => `block-${i}`,
		survivor: (i, gesture) =>
			survivorAfterRemoval({ kind: 'document', prefix: '', children, suffix: '' }, [i], gesture),
		collapseEmptyReplaceToDelete: opts.collapse ?? true,
		async commit(args) {
			commits.push(args);
			args.mutate({
				body: { children, owner: opts.owner, lineEnding: lineEnding() },
				sharing,
				reading: fixtureReading(),
				unshareChild: (i) => children[i]
			});
			const landing = args.landing?.();
			if (landing && 'path' in landing) await scope.land(landing);
			return true;
		},
		typeIn: (_i, _offset, work) => work(),
		writeInPlace: () => ({ wrote: false }),
		at: (i, subPath, offset) => ({ path: docPathFrom([i, ...subPath]), offset }),
		// No render window here: every ref counts as mounted.
		async land(pos) {
			const list = { kind: 'document' as const, prefix: '', children, suffix: '' };
			const target = caretTargetFor(list, pos);
			const block = target && componentAt(makeShimChildList(refs), target.leafPath);
			if (!target || !block) return 'unresolvable';
			block.focus(target.offset);
			return 'placed';
		}
	};
	return { scope, commits, children };
}

// ── Container-shim deps ──────────────────────────────────────────────────────

export function paragraphListNode(childCount: number): CstNode {
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

/** Every block in `deps`'s document answers the descent with a stub, so a caret landing anywhere
 *  is placed; `onFocus` hears each placement, named by the block's path when it was mounted. */
export function mountEveryBlock(
	deps: EditorActionsDeps,
	onFocus?: (mountedAt: number[], offset: number) => void
): void {
	const listAt = (path: number[]): ChildList =>
		makeShimChildList((nodeAt(deps.doc, path)?.children ?? []).map((_, i) => stubAt([...path, i])));
	const stubAt = (path: number[]): BlockComponent =>
		stubBlockComponent({
			childList: () => listAt(path),
			focus: (offset: number) => onFocus?.(path, offset)
		});
	deps.blockRefs.forEach((_, i) => (deps.blockRefs[i] = stubAt([i])));
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

/** A container's side of a focus move over `refs`, every ref mounted, handing a move off
 *  either end to `parentFocus` the way a nested container does. */
export function makeListFocusScope(
	refs: (BlockComponent | undefined)[],
	parentFocus: FocusActions,
	parentIndex: number,
	over: Partial<MoveFocusScope> = {}
): MoveFocusScope {
	return {
		count: () => refs.length,
		mount: async (index) => refs[index] ?? null,
		leave: async (step, position, options) => {
			await delegateMoveFocus(parentFocus, parentIndex + step, position, options);
		},
		gapStop: () => false,
		arrived: () => {},
		...over
	};
}

export function makeStubFocus(): FocusActions {
	return { moveFocus: vi.fn(), tryGapStop: () => false, followArrival: () => {} };
}

export function makeStubContainerEdit(): ContainerEditActions {
	return {
		commitContainer: vi.fn(),
		lineEnding: () => '\n',
		typeInLeaf: vi.fn((_path, _offset, _key, work) => work()),
		writeLeafInPlace: vi.fn(() => ({ wrote: false as const })),
		land: vi.fn(async () => 'placed' as const),
		survivorAfterRemoval: vi.fn(() => null)
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
		commitLeafText: vi.fn(async () => ({ wrote: false })),
		replaceBlock: vi.fn(async () => null),
		resolveState: getStateForNode,
		expectState: expectStateForNode,
		focusByPath: vi.fn()
	} as unknown as UndoController & PasteCommitCoordinator;
}

/** The inline range write over a document the test swaps at will and a controller it may stub:
 *  the write reads only the document and the reading off the root. */
export function makeInlineRange(
	getDoc: () => Document,
	controller: UndoController,
	reading = fixtureReading()
): InlineRangeCommit {
	const deps = {
		get doc() {
			return getDoc();
		},
		reading
	} as unknown as EditorActionsDeps;
	return createInlineRangeCommit({ deps, controller });
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
	landings: readonly RecordedLanding[];
} {
	const { deps, landings } = makeEditorActionsDeps(source);
	return {
		doc: deps.doc,
		controller: createPasteCoordinator(deps, createUndoController(deps)),
		landings
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
	caretMemory?: NestedActionsDeps['caretMemory'];
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
		stamps: createDocumentStamps(),
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
	/** Every leaf the editor's caret landing resolved to, in order. */
	landings: readonly RecordedLanding[];
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
	const { deps, events, contentVersion, landings } = makeEditorActionsDeps(
		source,
		reading ? { reading } : {}
	);
	if (opts.caretMemory) deps.caretMemory = opts.caretMemory;
	const controller = createUndoController(deps);
	const containerEdit = createContainerEditActions(deps, controller);
	const getNode = () => deps.doc.children[index];
	const state = makeBlockListState(getNode);
	// The editor's descent in miniature: a landing inside this container reaches its own refs.
	deps.blockRefs[index] = spyEvery(
		stubBlockComponent({ childList: () => makeShimChildList(state.innerBlockRefs) })
	);
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
			parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
		}),
		overrides
	);
	return {
		deps,
		events,
		controller,
		containerEdit,
		state,
		bundle,
		getNode,
		contentVersion,
		landings
	};
}

/** The container at `containerPath`, at any depth, over the real root: its node is read live
 *  through the document, since a commit replaces every ancestor it copies. */
export function makeContainerHarness(
	source: string,
	containerPath: number[],
	options: { reading?: Reading } = {}
) {
	const harness = makeEditorActionsDeps(parse(source), options);
	const controller = createUndoController(harness.deps);
	const focus = makeStubFocus();
	const { bundle, state, getNode } = containerBundleOver(
		harness.deps,
		controller,
		containerPath,
		focus
	);
	const edits: EditEvent[] = [];
	harness.events.on('edit', (e) => edits.push(e));
	return { ...harness, controller, bundle, state, getNode, focus, edits };
}

/** The action bundle of the container at `containerPath` over deps a caller already holds, so
 *  one document takes writes at the top level and inside a container alike. */
export function containerBundleOver(
	deps: EditorActionsDeps,
	controller: UndoController,
	containerPath: number[],
	focus: FocusActions = makeStubFocus()
) {
	const getNode = () => nodeAt(deps.doc, containerPath) as CstNode;
	const state = makeBlockListState(getNode);
	const bundle = createStandardNestedActions(
		state,
		makeNestedActionsDeps({
			index: containerPath[containerPath.length - 1],
			getNode,
			path: containerPath,
			reading: deps.reading,
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus,
				containerEdit: createContainerEditActions(deps, controller)
			}
		})
	);
	return { bundle, state, getNode };
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
	return { deps, controller, blockEdit: bundle.blockEdit };
}

/** The caret an admitted write reports; throws when the reading-mode check refused the write. */
export function admittedCaret(write: ContentWrite): number {
	if (!write.admitted) throw new Error('the write was refused, so it has no caret');
	return write.caret;
}

/** One `updateBlockContent` call as a recording stub saw it. */
export interface RecordedWrite {
	index: number;
	raw: string;
	mode: WriteMode;
	before: number;
	after: number | undefined;
}

/** An `updateBlockContent` that stores nothing: it reports each call and hands back the caret it
 *  was asked for, which is what the write returns when no rule rewrites the bytes. */
export function recordingWrite(
	record: (write: RecordedWrite) => void = () => {}
): (
	...args: Parameters<BlockEditActions['updateBlockContent']>
) => ReturnType<typeof withStoredCaret> {
	return (index, raw, mode, before, after) => {
		record({ index, raw, mode, before, after });
		return withStoredCaret(Promise.resolve(true), after ?? before);
	};
}
