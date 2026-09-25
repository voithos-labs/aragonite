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
import type { StickyColumnState } from '$lib/cursor/sticky-column';
import type { EdgeAffinityState } from '$lib/cursor/edge-affinity';
import { createPendingMarksState, type PendingMarksState } from '$lib/cursor/pending-marks';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import type { EditorActionsDeps, UndoController } from '$lib/editor-actions/deps';
import type { CommitScope, ScopeCommitArgs } from '$lib/editor-actions/block-edit-scope';
import type { ContainerBlockComponentDeps } from '$lib/editor-actions/container-block-component';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
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
import { defaultGrammarView, type GrammarView } from '$lib/schema/block-openers';
import { fixtureLinkRef } from './fixture-grammar';
import { parse } from '$lib/core/parser';
import type { EditEvent, EditorEvents } from '$lib/editor-events';
import { mountBlockListState } from '$lib/testing/headless-block-list.svelte';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import { getStateForNode, expectStateForNode } from '$lib/reactivity/state-registry';
import { createSharingState } from '$lib/tree-operations/sharing';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { GapStopScope } from '$lib/selection/gap-caret';
import {
	createHeadlessActions,
	stubBlockComponent,
	stubBlockEdit,
	stubEdgeAffinity,
	stubStickyColumn,
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

export function makeStickyColumn(x: number | null = null): Mocked<StickyColumnState> {
	const stickyX = x === null ? null : asEditorX(x);
	return spyEvery({ ...stubStickyColumn(), get: () => stickyX });
}

export function makeEdgeAffinity(): Mocked<EdgeAffinityState> {
	return spyEvery(stubEdgeAffinity());
}

/** The real state, armed with `kinds`: a stub would hide the one property every consumer
 *  depends on, that a set is spent exactly once. */
export function makePendingMarks(...kinds: InlineMarkKind[]): PendingMarksState {
	const marks = createPendingMarksState();
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

/** Runs the real mutate against a live children array, recording commits. */
export function makeCommitScopeStub(
	children: CstNode[],
	opts: { refs?: (BlockComponent | undefined)[]; collapse?: boolean; owner?: CstNode } = {}
): { scope: CommitScope; commits: ScopeCommitArgs[]; children: CstNode[] } {
	const refs = opts.refs ?? [];
	const commits: ScopeCommitArgs[] = [];
	const sharing = createSharingState();
	const scope: CommitScope = {
		children: () => children,
		refAt: (i) => refs[i],
		// No render window here: every ref counts as mounted.
		reveal: async (i, path) =>
			(path.length === 0 ? refs[i] : refs[i]?.getBlockComponentByPath?.([...path])) ?? null,
		collapseEmptyReplaceToDelete: opts.collapse ?? true,
		async commit(args) {
			commits.push(args);
			args.mutate({
				children,
				sharing,
				lineEnding: documentLineEnding({ kind: 'document', prefix: '', children, suffix: '' }),
				ownerKind: opts.owner?.kind,
				owner: opts.owner,
				getPresentationMode: undefined,
				linkRef: fixtureLinkRef(),
				unshareChild: (i) => children[i]
			});
			await args.afterTick?.();
		}
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

/** The five members every container shim repeats; `over` adds a test's own. Copied by property
 *  descriptor, so a getter in `over` stays live instead of freezing at call time. */
export function makeShimDeps(
	refs: (BlockComponent | undefined)[],
	over: Partial<ContainerBlockComponentDeps> = {}
): ContainerBlockComponentDeps {
	const deps: ContainerBlockComponentDeps = {
		selection: createSelectionState(),
		get innerBlockRefs() {
			return refs;
		},
		refSlots: refSlotsOver(refs),
		get nodeChildrenLength() {
			return refs.length;
		},
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
		pushDebouncedCheckpoint: vi.fn(),
		armDebouncedPause: vi.fn(),
		lineEnding: () => '\n',
		nudgeReactivity: vi.fn(),
		withUnsharedSpine: vi.fn(() => false)
	};
}

export function makeStubController(): UndoController & PasteCommitCoordinator {
	return {
		sharing: createSharingState(),
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		flushDebouncedCheckpoint: vi.fn(),
		// Runs the write: the batch breaks are the stubbed half, the bytes are not.
		isolateUndoEntry: vi.fn((write: () => void) => write()),
		joinUndoEntries: vi.fn((run: () => Promise<void>) => run()),
		endUndoJoin: vi.fn(),
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
 *  the default grammar, unless the fixture names its own. */
export function pasteContext(
	fields: Omit<PasteDispatchContext, 'grammar' | 'activePlugins'> &
		Partial<Pick<PasteDispatchContext, 'grammar' | 'activePlugins'>>
): PasteDispatchContext {
	return { grammar: defaultGrammarView, activePlugins: everyInstalledPlugin, ...fields };
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
		getPresentationMode: deps.getPresentationMode,
		linkRef: deps.linkRef
	});
	return { listContext, state, getNode, controller };
}

// ── Nested action-bundle harness ─────────────────────────────────────────────

export interface NestedActionsDepsInput {
	index: number;
	getNode: () => CstNode;
	path: number[];
	parent: NestedActionsDeps['parent'];
	stickyColumn?: StickyColumnState;
	grammar?: GrammarView;
	getPresentationMode?: NestedActionsDeps['getPresentationMode'];
	linkRef?: NestedActionsDeps['linkRef'];
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
		stickyColumn: input.stickyColumn ?? makeStickyColumn(),
		grammar: input.grammar ?? defaultGrammarView,
		getPresentationMode: input.getPresentationMode,
		linkRef: input.linkRef ?? fixtureLinkRef(),
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
	const { deps, events, contentVersion } = makeEditorActionsDeps(
		source,
		opts.presentationMode ? { presentationMode: opts.presentationMode } : {}
	);
	const controller = createUndoController(deps);
	const containerEdit = createContainerEditActions(deps, controller);
	const getNode = () => deps.doc.children[index];
	const state = makeBlockListState(getNode);
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
			grammar: opts.grammar,
			getPresentationMode: deps.getPresentationMode,
			parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
		}),
		overrides
	);
	return { deps, events, controller, containerEdit, state, bundle, getNode, contentVersion };
}
