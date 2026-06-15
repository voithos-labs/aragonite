// Shared mocks for editor-actions and selection unit tests.

import { vi } from 'vitest';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions
} from '$lib/editor/action-contracts';
import type { BlockComponent } from '$lib/editor/block-component';
import type { CstNode, Document } from '$lib/editor/core/nodes';
import type { StickyColumnState } from '$lib/editor/cursor/sticky-column';
import type { EditorActionsDeps } from '$lib/editor/editor-actions/deps';
import type { EditorEvents } from '$lib/editor/editor-events';
import type { BlockListState } from '$lib/editor/reactivity/block-list-state.svelte';
import { createUndoManager } from '$lib/editor/undo/manager';
import { createSharingState } from '$lib/editor/undo/epoch-tracker';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createEditorEvents } from '$lib/editor/editor-events';

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

export function makeStickyColumn(x: number | null = null): StickyColumnState {
	return { get: () => x, reset: vi.fn(), capture: vi.fn() };
}

// ── BlockListState stub ──────────────────────────────────────────────────────

// Mirrors production createBlockListState minus Svelte reactivity: ids are
// node-backed (read/written through getNode().childIds, so they follow the
// commit primitives' copy-path-on-write node replacement), refs are local.
// `getNode` must read the LIVE node (e.g. () => doc.children[0]) — a captured
// node reference goes stale after the first commit unshares its spine.
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
		}
	};
}

// ── Action-bundle stubs ──────────────────────────────────────────────────────

export function makeStubBlockEdit(): BlockEditActions {
	return {
		splitBlock: vi.fn(),
		mergeWithPrevious: vi.fn(),
		mergeWithNext: vi.fn(),
		deleteBlock: vi.fn(),
		updateBlockContent: vi.fn(),
		updateBlockMetadata: vi.fn(),
		insertParsedBlocks: vi.fn(),
		replaceBlock: vi.fn()
	};
}

export function makeStubFocus(): FocusActions {
	return { moveFocus: vi.fn() };
}

export function makeStubContainerEdit(): ContainerEditActions {
	return {
		commitContainer: vi.fn(),
		pushDebouncedCheckpoint: vi.fn(),
		nudgeReactivity: vi.fn(),
		withUnsharedSpine: vi.fn()
	};
}

// ── EditorActionsDeps factory ────────────────────────────────────────────────

export interface EditorActionsHarness {
	deps: EditorActionsDeps;
	doc: Document;
	events: EditorEvents;
	getBlockIds: () => string[];
	getBlockRefs: () => (BlockComponent | undefined)[];
}

// Builds an EditorActionsDeps over `docChildren` with the standard mutable
// id/ref slots (setBlockIds / setBlockRefs reassign internal arrays so tests
// can read post-mutation state via the returned getters).
export function makeEditorActionsDeps(docChildren: CstNode[]): EditorActionsHarness {
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
		selectionState: createSelectionState(),
		getBlockElByPath: () => null,
		events
	};
	return {
		deps,
		doc,
		events,
		getBlockIds: () => blockIds,
		getBlockRefs: () => blockRefs
	};
}
