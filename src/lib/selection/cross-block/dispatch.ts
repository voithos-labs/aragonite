/**
 * Cross-block event dispatch shared by TextEditableBlock and CodeBlock.
 * Factory returns handler functions each block component calls at the top
 * of its own event handlers; single-block handling stays in each component.
 *
 * This file is the composer: keydown lives in keydown.ts,
 * pointer in pointer.ts, and paste / type-replace are tiny
 * passthroughs to their dedicated modules.
 */

import type {
	BlockEditActions,
	ContainerEditActions,
	HistoryActions
} from '../../action-contracts';
import type { BlockComponent } from '../../block-component';
import type { BlockElLookup, DocumentGetter } from '../../editor-keys';
import type { SelectionState } from '../selection-state.svelte';
import type { CstNode } from '../../core/nodes';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { CrossBlockMutationContext } from './ops';
import type { CommitController } from '../../action-contracts';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import { performCrossBlockDelete } from './ops';
import { handleCrossBlockPaste } from './paste';
import { handleCrossBlockTypeReplace } from './type-replace';
import { createCrossBlockKeydown } from './keydown';
import { createCrossBlockPointer } from './pointer';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockDispatchContext {
	getEl: () => HTMLElement | null;
	getMyPath: () => number[];
	getIndex: () => number;

	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	revealPath: (path: number[]) => Promise<BlockComponent | null>;
	getEditorRoot: () => HTMLElement | null;
	/** Aborted when the owning editor unmounts. See EDITOR_LIFETIME_KEY. */
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	containerEdit: ContainerEditActions;
	blockEdit: BlockEditActions;
	controller: CommitController;
	history: HistoryActions;
	pasteCoordinator: PasteCommitCoordinator;

	getCursorOffset: () => number | null;

	/** Svelte's tick() — awaited after mutations so the DOM settles. */
	afterReactivity: () => Promise<void>;
	setPendingCursor: (offset: number) => void;
}

export interface CrossBlockHandlers {
	/** Returns true if the event was fully handled (caller should return). */
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handlePointerDown(e: PointerEvent): boolean;
	handlePaste(e: ClipboardEvent): Promise<boolean>;
	handleBeforeInput(e: InputEvent): Promise<boolean>;
	handleCompositionStart(): boolean;
	/**
	 * Cross-block range delete entry for Cut handlers — after they've
	 * synchronously written the collected text to e.clipboardData.
	 */
	performCrossBlockDeleteFromEvent(): Promise<void>;
}

export function createCrossBlockHandlers(ctx: CrossBlockDispatchContext): CrossBlockHandlers {
	const mutationCtx: CrossBlockMutationContext = {
		selection: ctx.selection,
		getDoc: ctx.getDoc,
		getBlockElByPath: ctx.getBlockElByPath,
		revealPath: ctx.revealPath,
		controller: ctx.controller,
		pushUndoSnapshot: () =>
			ctx.controller.pushUndoSnapshot(ctx.getIndex(), ctx.getCursorOffset() ?? 0)
	};

	const keydown = createCrossBlockKeydown(ctx, mutationCtx);
	const pointer = createCrossBlockPointer(ctx);

	return {
		handleKeyDown: keydown.handleKeyDown,
		handleCompositionStart: keydown.handleCompositionStart,
		handlePointerDown: pointer.handlePointerDown,
		handlePaste: (e) => handleCrossBlockPaste(ctx, mutationCtx, e),
		handleBeforeInput: (e) => handleCrossBlockTypeReplace(ctx, mutationCtx, e),
		performCrossBlockDeleteFromEvent: async () => {
			await performCrossBlockDelete(mutationCtx);
		}
	};
}
