// Shared mocks for editor-actions and selection unit tests.

import { vi } from 'vitest';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	ListContext
} from '$lib/action-contracts';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode, Document } from '$lib/core/nodes';
import { asEditorX } from '$lib/cursor/coordinate-spaces';
import type { StickyColumnState } from '$lib/cursor/sticky-column';
import type { EdgeAffinityState } from '$lib/cursor/edge-affinity';
import {
	createPendingMarksState,
	type InlineMarkKind,
	type PendingMarksState
} from '$lib/cursor/pending-marks';
import type { EditorActionsDeps, UndoController } from '$lib/editor-actions/deps';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
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
import type { GrammarView } from '$lib/schema/block-openers';
import { parse } from '$lib/core/parser';
import type { EditorEvents } from '$lib/editor-events';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	registerBlockListState,
	getStateForNode,
	expectStateForNode
} from '$lib/reactivity/state-registry';
import { createUndoManager } from '$lib/undo/manager';
import { createSharingState } from '$lib/tree-operations/sharing';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { GapStopScope } from '$lib/selection/gap-caret';
import { createEditorEvents } from '$lib/editor-events';

// ── CST node factory ─────────────────────────────────────────────────────────

/** A minimal leaf CST node for editor-action and invariant unit fixtures. */
export function makeNode(kind: string, raw: string): CstNode {
	return { kind, leadingTrivia: '', raw } as CstNode;
}

// ── BlockComponent / sticky-column stubs ─────────────────────────────────────

export function mockRef(overrides: Partial<BlockComponent> = {}): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true,
		...overrides
	} as BlockComponent;
}

/** A gap scope over `source`: the kinds it parses to are what declare the eligible edges. */
export function makeGapScope(source: string): GapStopScope {
	const doc = parse(source);
	return { getDoc: () => doc, selection: createSelectionState() };
}

/** An inert gap scope, for the walks that assert non-gap landings. */
export function makeEmptyGapScope(): GapStopScope {
	return makeGapScope('');
}

export function makeStickyColumn(x: number | null = null): StickyColumnState {
	const stickyX = x === null ? null : asEditorX(x);
	return { get: () => stickyX, reset: vi.fn(), capture: vi.fn(), noteKey: vi.fn() };
}

export function makeEdgeAffinity(): EdgeAffinityState {
	return {
		get: () => null,
		reset: vi.fn(),
		note: vi.fn(),
		noteTyping: vi.fn(),
		noteExtreme: vi.fn()
	};
}

/** The real state, armed with `kinds`: a stub would hide the one property every consumer
 *  depends on, that a set is spent exactly once. */
export function makePendingMarks(...kinds: InlineMarkKind[]): PendingMarksState {
	const marks = createPendingMarksState();
	for (const kind of kinds) marks.toggle(kind);
	return marks;
}

// ── BlockListState stub ──────────────────────────────────────────────────────

// Mirrors production createBlockListState minus Svelte reactivity: ids are
// node-backed so they follow copy-path-on-write node replacement, refs are local.
// `getNode` must read the LIVE node (e.g. () => doc.children[0]) — a captured node
// goes stale the first time a commit unshares its spine (tree-operations/unshare.ts).
// Every harness below carries the same getter rule for the same reason.
export function makeBlockListState(getNode: () => CstNode, ids?: string[]): BlockListState {
	const node = getNode();
	if (ids) node.childIds = [...ids];
	else if (!node.childIds) node.childIds = (node.children ?? []).map((_, i) => `auto-${i}`);
	let innerBlockRefs: (BlockComponent | undefined)[] = (node.childIds ?? []).map(() => undefined);
	return {
		get innerBlockIds() {
			return getNode().childIds ?? [];
		},
		set innerBlockIds(v: string[]) {
			getNode().childIds = v;
		},
		get innerBlockRefs() {
			return innerBlockRefs;
		},
		set innerBlockRefs(v: (BlockComponent | undefined)[]) {
			innerBlockRefs = v;
		},
		refSlots: refSlotsOver(() => innerBlockRefs)
	};
}

// ── Action-bundle stubs ──────────────────────────────────────────────────────

export function makeStubBlockEdit(): BlockEditActions {
	return {
		splitBlock: vi.fn(),
		descendToBody: vi.fn(),
		insertParagraph: vi.fn(),
		mergeWithPrevious: vi.fn(),
		mergeWithNext: vi.fn(),
		deleteBlock: vi.fn(),
		updateBlockContent: vi.fn(),
		updateBlockMetadata: vi.fn(),
		replaceBlock: vi.fn()
	};
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
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn(),
		resolveState: getStateForNode,
		expectState: expectStateForNode,
		focusByPath: vi.fn()
	} as unknown as UndoController & PasteCommitCoordinator;
}

// ── EditorActionsDeps factory ────────────────────────────────────────────────

export interface EditorActionsHarness {
	deps: EditorActionsDeps;
	doc: Document;
	events: EditorEvents;
	getBlockIds: () => string[];
	getBlockRefs: () => (BlockComponent | undefined)[];
}

// `onSelectionChange` has to be supplied here rather than attached later:
// SelectionState takes it at construction, so a test counting emissions cannot
// install one afterwards.
export function makeEditorActionsDeps(
	docChildren: CstNode[],
	options: { onSelectionChange?: () => void; presentationMode?: PresentationMode } = {}
): EditorActionsHarness {
	const doc: Document = { kind: 'document', prefix: '', children: docChildren, suffix: '' };
	let blockIds = docChildren.map((_, i) => `block-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = docChildren.map(() => mockRef());
	const events = createEditorEvents();
	const deps: EditorActionsDeps = {
		get doc() {
			return doc;
		},
		get blockIds() {
			return blockIds;
		},
		get blockRefs() {
			return blockRefs;
		},
		blockRefSlots: refSlotsOver(() => blockRefs),
		setDoc: (v: Document) => {
			Object.assign(doc, v);
		},
		setBlockIds: (v: string[]) => {
			blockIds = v;
		},
		setBlockRefs: (v: (BlockComponent | undefined)[]) => {
			blockRefs = v;
		},
		undoManager: createUndoManager(),
		sharing: createSharingState(),
		stickyColumn: makeStickyColumn(),
		edgeAffinity: makeEdgeAffinity(),
		selectionState: createSelectionState(
			options.onSelectionChange ? { onChange: options.onSelectionChange } : undefined
		),
		getBlockElByPath: () => null,
		// No render window in unit tests: every block is "mounted", so reveal is the
		// production fast path — resolve from the live ref slots, descend if nested.
		revealPath: async (path: number[]) => {
			if (path.length === 0) return null;
			const ref = blockRefs[path[0]];
			if (!ref) return null;
			if (path.length === 1) return ref;
			return ref.getBlockComponentByPath?.(path.slice(1)) ?? null;
		},
		events,
		getPresentationMode: options.presentationMode ? () => options.presentationMode! : undefined
	};
	return {
		deps,
		doc,
		events,
		getBlockIds: () => blockIds,
		getBlockRefs: () => blockRefs
	};
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
	registerBlockListState(getNode(), state);
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

// Every call site routes its input through here so the live-getter scope shape is
// minted once rather than re-derived per test.
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
		// Optional field: omit when absent rather than set undefined (exactOptionalPropertyTypes-safe).
		...(input.grammar ? { grammar: input.grammar } : {}),
		getPresentationMode: input.getPresentationMode,
		linkRef: input.linkRef,
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
}

export interface NestedHarnessOptions {
	/** Container index within the document; defaults to the last child. */
	index?: number;
	overrides?: NestedActionsOverrideFactory;
	/** Wire the standard list-item overrides (unwrap/merge/delete) onto the bundle. */
	listOverrides?: boolean;
	grammar?: GrammarView;
}

// Full nested-container setup over `source` (parsed) or an explicit node list. The
// state is the production createBlockListState (reactive, self-registering), so the
// container under test has a mounted container's shape.
export function makeNestedHarness(
	input: string | CstNode[],
	opts: NestedHarnessOptions = {}
): NestedHarness {
	const nodes = typeof input === 'string' ? parse(input).children : input;
	const index = opts.index ?? nodes.length - 1;
	const { deps, events } = makeEditorActionsDeps(nodes);
	const controller = createUndoController(deps);
	const containerEdit = createContainerEditActions(deps, controller);
	const getNode = () => deps.doc.children[index];
	const state = createBlockListState(getNode);
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
			parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
		}),
		overrides
	);
	return { deps, events, controller, containerEdit, state, bundle, getNode };
}
