/**
 * Headless editor-actions environment for the published conformance kit. These stubs
 * restate rather than reuse the in-repo `test/harness` mocks, which are `vi.fn()`-based:
 * `aragonite/testing` is imported into an author's own suite, so a static runner import
 * would load Vitest for anyone reaching for `resetPluginPlatformForTests` alone.
 */

import type { BlockEditActions, FocusActions } from '../action-contracts';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { EdgeAffinityState } from '../cursor/edge-affinity';
import type { EditorActionsDeps } from '../editor-actions/deps';
import { createEditorEvents, type EditorEvents } from '../editor-events';
import { createBlockListState, type BlockListState } from '../reactivity/block-list-state.svelte';
import { refSlotsOver } from '../reactivity/publish-ref.svelte';
import { createSelectionState } from '../selection/selection-state.svelte';
import { createSharingState } from '../tree-operations/sharing';
import { createUndoManager } from '../undo/manager';

// ── Stubs ────────────────────────────────────────────────────────────────────

export function stubBlockComponent(): BlockComponent {
	return {
		focus: () => {},
		parkCaret: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

export function stubStickyColumn(): StickyColumnState {
	return { get: () => null, reset: () => {}, capture: () => {}, noteKey: () => {} };
}

export function stubEdgeAffinity(): EdgeAffinityState {
	return { get: () => null, reset: () => {}, note: () => {}, noteTyping: () => {} };
}

export function stubBlockEdit(): BlockEditActions {
	return {
		splitBlock: () => {},
		descendToBody: () => {},
		insertParagraph: () => {},
		mergeWithPrevious: () => {},
		mergeWithNext: () => {},
		deleteBlock: () => {},
		updateBlockContent: () => {},
		updateBlockMetadata: () => {},
		replaceBlock: () => {}
	};
}

/** A focus bundle that records what bubbled up to it — the focus-bubble check's oracle. */
export interface RecordingFocus extends FocusActions {
	/** Whole argument lists, so a check pins arity as well as values. */
	readonly moveFocusCalls: readonly unknown[][];
}

export function recordingFocus(): RecordingFocus {
	const moveFocusCalls: unknown[][] = [];
	return {
		moveFocusCalls,
		moveFocus: (...args: unknown[]) => {
			moveFocusCalls.push(args);
		},
		// The focus-bubble consumers assert on moveFocus, never on a resolved component.
		revealPath: async () => null,
		// Headless: no rendered boundary to park a gap caret at.
		tryGapStop: () => false
	};
}

// ── Block-list state ─────────────────────────────────────────────────────────

/**
 * A BlockListState seeded with one ref per child (the `$effect` that fills refs never
 * runs headlessly). `getNode` must read the LIVE node: the commit primitives replace the
 * spine's nodes, so a captured reference goes stale after the first commit.
 */
export function mountBlockListState(getNode: () => CstNode): BlockListState {
	const state = createBlockListState(() => getNode());
	state.innerBlockRefs = (getNode().children ?? []).map(() => stubBlockComponent());
	return state;
}

// ── Editor-actions environment ───────────────────────────────────────────────

export interface HeadlessActions {
	deps: EditorActionsDeps;
	doc: Document;
	events: EditorEvents;
}

/** An `EditorActionsDeps` over `docChildren`, with every block treated as mounted. */
export function createHeadlessActions(docChildren: CstNode[]): HeadlessActions {
	const doc: Document = { kind: 'document', prefix: '', children: docChildren, suffix: '' };
	let blockIds = docChildren.map((_, i) => `block-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = docChildren.map(() => stubBlockComponent());
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
		stickyColumn: stubStickyColumn(),
		edgeAffinity: stubEdgeAffinity(),
		selectionState: createSelectionState(),
		getBlockElByPath: () => null,
		revealPath: async (path: number[]) => {
			if (path.length === 0) return null;
			const ref = blockRefs[path[0]];
			if (!ref) return null;
			if (path.length === 1) return ref;
			return ref.getBlockComponentByPath?.(path.slice(1)) ?? null;
		},
		events
	};
	return { deps, doc, events };
}
