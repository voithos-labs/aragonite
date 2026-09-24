/**
 * Cross-block event dispatch, wired by `components/blocks/editable-surface.ts` and by
 * `Editor.svelte` for the editor root. The factory returns handlers each caller runs at the top
 * of its own event handlers; single-block handling stays with the caller. Keydown lives in
 * `keydown.ts` and pointer in `pointer.ts`; paste and type-replace pass through here.
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
import type { SelectedWidgetHandle } from '../primitives';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { EdgeAffinityState } from '../../cursor/edge-affinity';
import type { CrossBlockMutationContext } from './ops';
import type { CommitController } from '../../action-contracts';
import type { KeybindingOverrideMap } from '../../schema/keybinding-overrides';
import type { CommandErrorSink, CrossBlockCommandRouter } from '../../schema/block-commands';
import type { EditorEvents } from '../../editor-events';
import type { GrammarView } from '../../schema/block-openers';
import type { PluginActivation } from '../../schema/plugin-activation';
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
	// Passed so a post-delete command dispatch reaches a plugin-global handler and contains its
	// throw. Required but nullable, so a new context constructor cannot silently skip it.
	pluginEditor: PluginEditorLookup | undefined;
	/** The effective presentation mode; the reading-mode check on the destructive branches reads it. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, forwarded to the delete's join cleanup. Required
	 *  but nullable like `pluginEditor`, so a new construction site cannot silently skip it. */
	linkRef: LinkReferenceResolverRef;
	onCommandError: CommandErrorSink | undefined;
	/** The handler a format chord takes over the live range; the dispatcher routes there rather
	 *  than declining. Non-nullable: without it a format chord is swallowed and nothing happens. */
	crossBlockCommands: CrossBlockCommandRouter;
	getKeybindingOverrides: () => KeybindingOverrideMap;
	pasteCoordinator: PasteCommitCoordinator;
	/** Block grammar forwarded to the paste reparse. */
	grammar: GrammarView;
	/** The plugins this instance activated, forwarded to the paste hooks. */
	activePlugins: PluginActivation;
	/** The editor's event emitter, the paste handler's only channel for a gesture it consumed but
	 *  could not land. Non-nullable: skipping it drops a paste in silence. */
	events: EditorEvents;

	getCursorOffset: () => number | null;
	/** An image selected whole, which a shift-press grows its range from. */
	selectedWidget: SelectedWidgetHandle;

	/** Svelte's `tick()`, awaited after mutations so the DOM has updated. */
	afterReactivity: () => Promise<void>;
}

/** What the block handling a press knows about it that the shared pointer handler cannot read. */
export interface PointerPressOptions {
	/** The press landed on a non-editable inline widget (an emoji), which the browser starts no
	 *  drag from, so the block paints the range itself or the drag selects nothing. */
	paintSameBlock?: boolean;
	/** The raw offset the press anchors at, from a block that resolves its own press better than
	 *  the browser's hit test does. Absent, the point is hit-tested. */
	anchorOffset?: number;
}

export interface CrossBlockHandlers {
	/** Returns true if the event was fully handled (caller should return). */
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handlePointerDown(e: PointerEvent, press?: PointerPressOptions): boolean;
	/** `replacement` stands in for the clipboard's own text, for a caller that already turned the
	 *  payload into markdown and must not re-read the event past its awaits. A null event is a
	 *  programmatic insertion: no gesture to consume, so `replacement` carries the payload. */
	handlePaste(e: ClipboardEvent | null, replacement?: string): Promise<boolean>;
	handleBeforeInput(e: InputEvent): Promise<boolean>;
	/** Type-replace from a caller with no `InputEvent`: the editor root, where a range over a block
	 *  with no character position leaves no editable element for `beforeinput` to fire on. */
	insertText(text: string): Promise<boolean>;
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

	// The reading-mode checks for the mutating handlers live here, so every construction site
	// (each editable block, the editor root) inherits them. Keydown checks its own destructive
	// branches, since it also carries navigation, which stays live.
	const reading = () => isReadingMode(ctx.getPresentationMode);

	const insertText = async (text: string): Promise<boolean> => {
		if (reading()) return true;
		if (!ctx.selection.isCrossBlock) return false;
		await handleCrossBlockTypeReplace(ctx, mutationCtx, text);
		return true;
	};

	return {
		handleKeyDown: keydown.handleKeyDown,
		handleCompositionStart: keydown.handleCompositionStart,
		handlePointerDown: pointer.handlePointerDown,
		handlePaste: async (e, replacement) => {
			if (reading()) {
				e?.preventDefault();
				return true;
			}
			return handleCrossBlockPaste(ctx, mutationCtx, e, replacement);
		},
		handleBeforeInput: async (e) => {
			if (reading()) {
				e.preventDefault();
				return true;
			}
			if (!ctx.selection.isCrossBlock || e.inputType !== 'insertText') return false;
			e.preventDefault();
			return insertText(e.data ?? '');
		},
		insertText,
		performCrossBlockDeleteFromEvent: async () => {
			// Reached from cut handlers after the clipboard write; declining the delete
			// degrades a reading-mode cut to a copy.
			if (reading()) return;
			await performCrossBlockDelete(mutationCtx);
		}
	};
}
