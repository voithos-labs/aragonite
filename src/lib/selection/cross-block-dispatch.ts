/**
 * Cross-block event dispatch shared by TextEditableBlock and CodeBlock.
 * Factory returns handler functions each block component calls at the top
 * of its own event handlers; single-block handling stays in each component.
 *
 * This file is the composer: keydown lives in cross-block-keydown.ts,
 * pointer in cross-block-pointer.ts, and paste / type-replace are tiny
 * passthroughs to their dedicated modules.
 */

import type { SelectionState } from './selection-state.svelte';
import type {
	BlockElLookup,
	BlockComponentLookup,
	BlockEditActions,
	ContainerEditActions,
	DocumentGetter
} from '../contracts';
import type { CstNode } from '../core/nodes';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { CrossBlockMutationContext } from './cross-block-ops';
import type { UndoController } from '../editor-actions/deps';
import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import { performCrossBlockDelete } from './cross-block-ops';
import { handleCrossBlockPaste } from './cross-block-paste';
import { handleCrossBlockTypeReplace } from './cross-block-type-replace';
import { createCrossBlockKeydown } from './cross-block-keydown';
import { createCrossBlockPointer } from './cross-block-pointer';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockDispatchContext {
	getEl: () => HTMLElement | null;
	getMyPath: () => number[];
	getIndex: () => number;

	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	getBlockComponentByPath: BlockComponentLookup;
	getEditorRoot: () => HTMLElement | null;
	/** Aborted when the owning editor unmounts. See EDITOR_LIFETIME_KEY. */
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	containerEdit: ContainerEditActions;
	blockEdit: BlockEditActions;
	controller: UndoController;
	pasteCoordinator: PasteCommitCoordinator;

	getCursorOffset: () => number | null;

	/** Svelte's tick() — awaited after mutations so the DOM settles. */
	afterReactivity: () => Promise<void>;
	setPendingCursor: (offset: number) => void;

	/**
	 * Post-mutation hook for cross-block type-replace, called after the typed
	 * character is spliced into the target node's raw. TextEditableBlock uses
	 * it to reparse inline content; CodeBlock doesn't need one.
	 */
	afterRawMutated?: (node: CstNode) => void;
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
		controller: ctx.controller,
		pushUndoSnapshot: () =>
			ctx.controller.pushUndoSnapshot(ctx.getIndex(), ctx.getCursorOffset() ?? 0),
		notifyDocMutated: () => ctx.containerEdit.nudgeReactivity()
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
