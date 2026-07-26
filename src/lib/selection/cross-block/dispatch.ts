/**
 * Cross-block event dispatch, wired by `components/blocks/editable-surface.ts`
 * (every editable block) and by `Editor.svelte` for editor-root routing. The
 * factory returns handlers each caller runs at the top of its own event
 * handlers; single-block handling stays with the caller.
 *
 * This file is the composer: keydown lives in keydown.ts, pointer in pointer.ts,
 * and paste / type-replace are passthroughs to their dedicated modules.
 */

import type { BlockEditActions, HistoryActions } from '../../action-contracts';
import type { BlockComponent } from '../../block-component';
import type {
	BlockElLookup,
	DocumentGetter,
	PluginEditorLookup,
	PresentationModeGetter
} from '../../editor-keys';
import type { SelectionState } from '../selection-state.svelte';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { CrossBlockMutationContext } from './ops';
import type { CommitController } from '../../action-contracts';
import type { KeybindingOverrideMap } from '../../schema/keybinding-overrides';
import type { CommandErrorSink } from '../../schema/block-commands';
import type { GrammarView } from '../../schema/block-openers';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import { isReadingMode } from '../../presentation-mode';
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
	/** Aborted when the owning editor unmounts. See the document facet's `lifetime`. */
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	blockEdit: BlockEditActions;
	controller: CommitController;
	history: HistoryActions;
	// Threaded so a post-delete command dispatch reaches a plugin-global handler and
	// contains its throw — required fields (undefinable value) so a new cross-block
	// context constructor can't silently skip the thread (sibling-path parity).
	pluginEditor: PluginEditorLookup | undefined;
	/** The effective presentation mode — the destructive-branch reading gate keys off
	 *  this, a sibling thread to `pluginEditor` (never the lookup). */
	getPresentationMode: PresentationModeGetter | undefined;
	onCommandError: CommandErrorSink | undefined;
	getKeybindingOverrides: () => KeybindingOverrideMap;
	pasteCoordinator: PasteCommitCoordinator;
	/** The instance's block grammar, forwarded to the join-paste reparse so a disabled
	 *  kind's opener stays skipped when a cross-block paste completes marker syntax.
	 *  Required-nullable like `pluginEditor` so a new construction site can't silently
	 *  skip the thread; `undefined` = the global grammar. */
	grammar: GrammarView | undefined;

	getCursorOffset: () => number | null;

	/** Svelte's tick() — awaited after mutations so the DOM settles. */
	afterReactivity: () => Promise<void>;
}

export interface CrossBlockHandlers {
	/** Returns true if the event was fully handled (caller should return). */
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handlePointerDown(e: PointerEvent): boolean;
	/** `replacement` stands in for the clipboard's own text, for a caller that has
	 *  already turned the payload into markdown (the image-import arm) and must not
	 *  re-read the event past its awaits. */
	handlePaste(e: ClipboardEvent, replacement?: string): Promise<boolean>;
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

	// Reading-mode gates for the mutating halves live here at the composer, so
	// every construction site (each editable surface, the editor root) inherits
	// them. Keydown gates its own destructive branches — it also carries
	// navigation, which stays live. The mode arrives through ctx.getPresentationMode,
	// the dedicated getter this context threads beside the plugin lookup.
	const reading = () => isReadingMode(ctx.getPresentationMode);

	return {
		handleKeyDown: keydown.handleKeyDown,
		handleCompositionStart: keydown.handleCompositionStart,
		handlePointerDown: pointer.handlePointerDown,
		handlePaste: async (e, replacement) => {
			if (reading()) {
				e.preventDefault();
				return true;
			}
			return handleCrossBlockPaste(ctx, mutationCtx, e, replacement);
		},
		handleBeforeInput: async (e) => {
			if (reading()) {
				e.preventDefault();
				return true;
			}
			return handleCrossBlockTypeReplace(ctx, mutationCtx, e);
		},
		performCrossBlockDeleteFromEvent: async () => {
			// Reached from cut handlers after the clipboard write — declining the
			// delete degrades a reading-mode cut to a copy.
			if (reading()) return;
			await performCrossBlockDelete(mutationCtx);
		}
	};
}
