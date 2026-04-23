import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor/editor-actions/undo-controller';
import { createContainerEditActions } from '$lib/editor/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor/editor-actions/nested-actions';
import { createBlockListState } from '$lib/editor/block-list-state.svelte';
import { createUndoManager } from '$lib/editor/undo-manager';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createEditorEvents } from '$lib/editor/events/editor-events';
import type {
	BlockComponent,
	BlockEditActions,
	FocusActions,
	CstNode
} from '$lib/editor/contracts';
import type { StickyColumnState } from '$lib/editor/contenteditable/sticky-column';

function mockRef(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

function makeStickyColumn(): StickyColumnState {
	return { get: () => null, reset: vi.fn(), capture: vi.fn() };
}

function makeContainer(childRaws: string[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: childRaws.map((r) => `> ${r}`).join(''),
		children: childRaws.map((r) => ({
			kind: 'paragraph',
			leadingTrivia: '',
			raw: r
		})) as CstNode[],
		innerPrefix: '> ',
		innerSuffix: ''
	} as CstNode;
}

function makeSetup(childRaws: string[]) {
	const containerNode = makeContainer(childRaws);

	const doc: any = { kind: 'document', children: [containerNode] };
	let blockIds = ['container-id'];
	let blockRefs: (BlockComponent | undefined)[] = [mockRef()];
	const events = createEditorEvents();
	const deps = {
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

	const controller = createUndoController(deps);
	const containerEditActions = createContainerEditActions(deps, controller);

	const parentBlockEdit: BlockEditActions = {
		splitBlock: vi.fn(),
		mergeWithPrevious: vi.fn(),
		mergeWithNext: vi.fn(),
		deleteBlock: vi.fn(),
		updateBlockContent: vi.fn(),
		updateBlockMetadata: vi.fn(),
		insertParsedBlocks: vi.fn(),
		replaceBlock: vi.fn()
	};
	const parentFocus: FocusActions = { moveFocus: vi.fn() };

	const containerState = createBlockListState(() => containerNode);
	const bundle = createStandardNestedActions(containerState, {
		index: 0,
		get node() {
			return containerNode;
		},
		rebuildRaw: vi.fn(),
		stickyColumn: makeStickyColumn(),
		parent: {
			blockEdit: parentBlockEdit,
			focus: parentFocus,
			containerEdit: containerEditActions
		}
	});

	return { bundle, containerNode, containerState, controller, deps };
}

// ── B7: debounce batches break on focus change between sibling leaves ─────────

describe('debounce batch key — sibling leaves inside one container (B7)', () => {
	it('typing in leaf 0 then leaf 1 produces two undo entries (focus break)', async () => {
		const { bundle, controller, deps } = makeSetup(['hello\n', 'world\n']);

		// Simulate typing 1 char into leaf 0 — first stroke pushes a snapshot.
		await bundle.blockEdit.updateBlockContent(0, 'hello1\n', 5);
		// Simulate "focus moved to leaf 1, then typed" — the new leaf's id key
		// must break the batch even though needsUndoCheckpoint is still false.
		await bundle.blockEdit.updateBlockContent(1, 'world1\n', 5);

		// Two snapshots: one before each leaf's typing batch.
		expect(deps.undoManager.getStacks().undo).toHaveLength(2);
		// Cleanup the still-pending debounce timer so vitest exits cleanly.
		controller.clearDebouncedCheckpoint();
	});

	it('typing in leaf 0, leaf 1, then leaf 0 again produces three undo entries', async () => {
		const { bundle, controller, deps } = makeSetup(['a\n', 'b\n', 'c\n']);

		await bundle.blockEdit.updateBlockContent(0, 'a1\n', 1);
		await bundle.blockEdit.updateBlockContent(1, 'b1\n', 1);
		await bundle.blockEdit.updateBlockContent(0, 'a12\n', 2);

		expect(deps.undoManager.getStacks().undo).toHaveLength(3);
		controller.clearDebouncedCheckpoint();
	});

	it('typing repeatedly into the same leaf still produces one batch (no spurious breaks)', async () => {
		const { bundle, controller, deps } = makeSetup(['hi\n', 'yo\n']);

		await bundle.blockEdit.updateBlockContent(0, 'hi1\n', 2);
		await bundle.blockEdit.updateBlockContent(0, 'hi12\n', 3);
		await bundle.blockEdit.updateBlockContent(0, 'hi123\n', 4);

		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
		controller.clearDebouncedCheckpoint();
	});
});
