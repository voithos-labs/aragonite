/**
 * Cross-block event dispatch, wired by `components/blocks/editable-surface.ts` and by
 * `Editor.svelte` for editor-root routing. The factory returns handlers each caller runs at the
 * top of its own event handlers; single-block handling stays with the caller. This file is the
 * composer: keydown in keydown.ts, pointer in pointer.ts, paste / type-replace passthroughs.
 */

import type { BlockEditActions, HistoryActions } from '../../action-contracts';
import type { BlockComponent } from '../../block-component';
import type {
	BlockElLookup,
	DocumentGetter,
	LinkReferenceResolverRef,
	PluginEditorLookup,
	PresentationModeGetter
} from '../../editor-keys';
import type { UserScrollport } from '../../cursor/scroll-ancestors';
import type { SelectionState } from '../selection-state.svelte';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { EdgeAffinityState } from '../../cursor/edge-affinity';
import type { CrossBlockMutationContext } from './ops';
import type { CommitController } from '../../action-contracts';
import type { KeybindingOverrideMap } from '../../schema/keybinding-overrides';
import type { CommandErrorSink } from '../../schema/block-commands';
import type { EditorEvents } from '../../editor-events';
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
	/** What autoscrolls a drag-select that reaches an edge: the root, the host's scroller, or the
	 *  window. See `cursor/scroll-ancestors`. */
	getScrollHost: () => UserScrollport | null;
	/** Aborted when the owning editor unmounts. See the document facet's `lifetime`. */
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	blockEdit: BlockEditActions;
	controller: CommitController;
	history: HistoryActions;
	// Threaded so a post-delete command dispatch reaches a plugin-global handler and contains its
	// throw. Required-nullable so a new context constructor can't silently skip the thread.
	pluginEditor: PluginEditorLookup | undefined;
	/** The effective presentation mode; the destructive-branch reading gate keys off this. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, forwarded to the delete's join seam. Required-
	 *  nullable like `pluginEditor`, so a new construction site can't silently skip the thread. */
	linkRef: LinkReferenceResolverRef | undefined;
	onCommandError: CommandErrorSink | undefined;
	getKeybindingOverrides: () => KeybindingOverrideMap;
	pasteCoordinator: PasteCommitCoordinator;
	/** Block grammar forwarded to the join-paste reparse. Required-nullable like `pluginEditor`
	 *  so a new construction site can't silently skip the thread; `undefined` = global. */
	grammar: GrammarView | undefined;
	/** The instance event surface, the paste arm's only channel for a gesture it consumed but
	 *  could not land. Non-nullable: skipping it drops a paste in silence. */
	events: EditorEvents;

	getCursorOffset: () => number | null;

	/** Svelte's tick() — awaited after mutations so the DOM settles. */
	afterReactivity: () => Promise<void>;
}

export interface CrossBlockHandlers {
	/** Returns true if the event was fully handled (caller should return). */
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handlePointerDown(e: PointerEvent): boolean;
	/** `replacement` stands in for the clipboard's own text, for a caller that already turned the
	 *  payload into markdown and must not re-read the event past its awaits. */
	handlePaste(e: ClipboardEvent, replacement?: string): Promise<boolean>;
	handleBeforeInput(e: InputEvent): Promise<boolean>;
	handleCompositionStart(): boolean;
	/** Cross-block range delete for Cut handlers, after they synchronously wrote the clipboard. */
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
			ctx.controller.pushUndoSnapshot(ctx.getIndex(), ctx.getCursorOffset() ?? 0),
		grammar: ctx.grammar,
		getPresentationMode: ctx.getPresentationMode,
		linkRef: ctx.linkRef
	};

	const keydown = createCrossBlockKeydown(ctx, mutationCtx);
	const pointer = createCrossBlockPointer(ctx);

	// Reading-mode gates for the mutating halves live at the composer, so every construction site
	// (each editable surface, the editor root) inherits them. Keydown gates its own destructive
	// branches, since it also carries navigation, which stays live.
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
			// Reached from cut handlers after the clipboard write; declining the delete
			// degrades a reading-mode cut to a copy.
			if (reading()) return;
			await performCrossBlockDelete(mutationCtx);
		}
	};
}
