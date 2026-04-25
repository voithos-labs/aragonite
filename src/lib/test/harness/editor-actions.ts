// Shared mocks for editor-actions / selection unit tests. Eliminates
// per-file duplication of mockRef / makeStickyColumn / makeBlockListState /
// stub action bundles / makeDeps across the suite.

import { vi } from 'vitest';
import type {
	BlockComponent,
	BlockEditActions,
	FocusActions,
	CstNode
} from '$lib/editor/contracts';
import type { EditorActionsDeps } from '$lib/editor/editor-actions/deps';
import type { StickyColumnState } from '$lib/editor/cursor/sticky-column';
import { createUndoManager } from '$lib/editor/undo-manager';
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

export function makeStickyColumn(): StickyColumnState {
	return { get: () => null, reset: vi.fn(), capture: vi.fn() };
}

// ── BlockListState stub ──────────────────────────────────────────────────────

// Minimal BlockListState shape used by container-edit and list-context paths:
// only the inner-id/ref arrays are observed, so the stub doesn't need the
// full reactivity surface. Cast to `any` at the call site for typed slots.
export function makeBlockListState(ids: string[]) {
	let innerBlockIds = [...ids];
	let innerBlockRefs: (BlockComponent | undefined)[] = ids.map(() => undefined);
	return {
		get innerBlockIds() {
			return innerBlockIds;
		},
		set innerBlockIds(v: string[]) {
			innerBlockIds = v;
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

// ── EditorActionsDeps factory ────────────────────────────────────────────────

// Builds an EditorActionsDeps over `docChildren` with the standard mutable
// id/ref slots (setBlockIds / setBlockRefs reassign internal arrays so tests
// can read post-mutation state via the returned getters). Returns the deps
// plus the raw doc / events / id-ref accessors most consumers wrap around.
export function makeEditorActionsDeps(docChildren: CstNode[]) {
	const doc: any = { kind: 'document', children: docChildren };
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
		setDoc: (v: any) => {
			Object.assign(doc, v);
		},
		setBlockIds: (v: string[]) => {
			blockIds = v;
		},
		setBlockRefs: (v: (BlockComponent | undefined)[]) => {
			blockRefs = v;
		},
		undoManager: createUndoManager(),
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
