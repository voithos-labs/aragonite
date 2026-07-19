/**
 * Headless editor-actions environment for the published conformance kit.
 *
 * Runner-agnostic on purpose. `aragonite/testing` is imported INTO an author's
 * own test case, so it must not import a test runner: a plain thrown `Error` is
 * reported correctly by Vitest, Jest and `node:test` alike, and a static
 * `vitest` import would eagerly load the runner for anyone reaching for
 * `resetPluginPlatformForTests` alone. That is why these stubs restate, rather
 * than reuse, the in-repo `test/harness` mocks — those are `vi.fn()`-based and
 * stay internal.
 */

import type { BlockEditActions, FocusActions } from '../action-contracts';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { EditorActionsDeps } from '../editor-actions/deps';
import { createEditorEvents, type EditorEvents } from '../editor-events';
import { createBlockListState, type BlockListState } from '../reactivity/block-list-state.svelte';
import { createSelectionState } from '../selection/selection-state.svelte';
import { createSharingState } from '../tree-operations/sharing';
import { createUndoManager } from '../undo/manager';

// ── Stubs ────────────────────────────────────────────────────────────────────

export function stubBlockComponent(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

export function stubStickyColumn(): StickyColumnState {
	return { get: () => null, reset: () => {}, capture: () => {} };
}

export function stubBlockEdit(): BlockEditActions {
	return {
		splitBlock: () => {},
		descendToBody: () => {},
		mergeWithPrevious: () => {},
		mergeWithNext: () => {},
		deleteBlock: () => {},
		updateBlockContent: () => {},
		updateBlockMetadata: () => {},
		insertParsedBlocks: () => {},
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
		// The focus-bubble consumers assert on moveFocus, not on a resolved
		// component, and model no render window.
		revealPath: async () => null
	};
}

// ── Block-list state ─────────────────────────────────────────────────────────

/**
 * A BlockListState seeded with one ref per child. `getNode` must read the LIVE
 * node — the commit primitives replace the spine's nodes, so a captured
 * reference goes stale after the first commit. The `$effect` that fills refs in
 * a mounted editor never runs headlessly, hence the manual seed.
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
