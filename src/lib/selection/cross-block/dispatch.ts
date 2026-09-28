/**
 * Cross-block event dispatch: handlers an editable block, or the editor root, runs at the top of
 * its own event handlers, before its single-block handling.
 */

import type { BlockEditActions } from '../../action-contracts';
import type { BlockComponent } from '../../block-component';
import type { BlockElLookup, DocumentGetter } from '../../editor-keys';
import type { UserScrollport } from '../../cursor/scroll-ancestors';
import type { ScrollOwner } from '../../cursor/scroll-owner';
import type { SelectionState } from '../selection-state.svelte';
import type { SelectedWidgetHandle } from '../primitives';
import type { CaretMemory } from '../../cursor/caret-memory';
import type { CaretLanding } from '../caret-landing';
import type { CrossBlockMutationContext } from './ops';
import type { CommitController } from '../../action-contracts';
import type { CommandDispatchContext } from '../../schema/block-commands';
import type { EditorEvents } from '../../editor-events';
import type { Reading } from '../../schema/reading';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import { isReadingMode } from '../../presentation-mode';
import { performCrossBlockDelete } from './ops';
import { handleCrossBlockPaste } from './paste';
import { handleCrossBlockTypeReplace } from './type-replace';
import { createCrossBlockKeydown } from './keydown';
import { createCrossBlockPointer, type PaddingPress } from './pointer';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockDispatchContext {
	getEl: () => HTMLElement | null;
	getMyPath: () => number[];

	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	/** Where a collapse, an extend's parked caret and a command's target block are put down. */
	caretLanding: Pick<CaretLanding, 'restore' | 'park' | 'mount'>;
	/** A mount for the delete, typing and paste over a range, which still place their own caret. */
	revealPath: (path: number[]) => Promise<BlockComponent | null>;
	getEditorRoot: () => HTMLElement | null;
	/** What autoscrolls a drag-select that reaches an edge: the root, the host's scroller, or the
	 *  window. See `cursor/scroll-ancestors`. */
	getScrollHost: () => UserScrollport | null;
	/** Brings the endpoint a keyboard extend reached to the nearest edge. */
	scrollOwner: Pick<ScrollOwner, 'showNearest'>;
	/** Aborted when the owning editor unmounts. See the document facet's `lifetime`. */
	getEditorLifetime: () => AbortSignal | null;
	caretMemory: CaretMemory;
	blockEdit: BlockEditActions;
	controller: CommitController;
	/** How the editor reads its bytes: the delete's join cleanup and the paste reparse read it, and
	 *  the destructive branches refuse its reading mode. */
	reading: Reading;
	/** The editor's command dispatch, which runs a chord pressed over a range. */
	commands: CommandDispatchContext;
	pasteCoordinator: PasteCommitCoordinator;
	/** The plugins this instance activated, forwarded to the paste hooks. */
	activePlugins: PluginActivation;
	/** The editor's event emitter, the paste handler's only channel for a gesture it consumed but
	 *  could not land. Non-nullable: skipping it drops a paste in silence. */
	events: EditorEvents;

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
	/** A block that runs its own drag from a press (a table's cell rectangle) installs it here, told
	 *  of a press in the padding the editor placed itself, where no native drag runs. */
	ownDrag?: (padding: PaddingPress | null) => void;
}

export interface CrossBlockHandlers {
	/** Returns true if the event was fully handled (caller should return). */
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handlePointerDown(e: PointerEvent, press?: PointerPressOptions): boolean;
	/** `replacement` stands in for the clipboard text, for a caller that already converted the
	 *  payload and can't re-read the event after its awaits. A null event is a scripted insert. */
	handlePaste(e: ClipboardEvent | null, replacement?: string): Promise<boolean>;
	handleBeforeInput(e: InputEvent): Promise<boolean>;
	/** Type-replace from a caller with no `InputEvent`: the editor root, where a range over a block
	 *  with no character position leaves no editable element for `beforeinput` to fire on. */
	insertText(text: string): Promise<boolean>;
	handleCompositionStart(): boolean;
	/** The delete half of a cut, run once the handler wrote the clipboard synchronously. */
	performCrossBlockCut(): Promise<void>;
}

export function createCrossBlockHandlers(ctx: CrossBlockDispatchContext): CrossBlockHandlers {
	const mutationCtx: CrossBlockMutationContext = {
		selection: ctx.selection,
		getDoc: ctx.getDoc,
		getBlockElByPath: ctx.getBlockElByPath,
		revealPath: ctx.revealPath,
		controller: ctx.controller,
		reading: ctx.reading
	};

	const keydown = createCrossBlockKeydown(ctx, mutationCtx);
	const pointer = createCrossBlockPointer(ctx);

	// The reading-mode checks for the mutating handlers live here so every caller inherits them;
	// keydown checks its own destructive branches, since its navigation stays live.
	const refusesWrites = () => isReadingMode(ctx.reading.mode);

	const insertText = async (text: string): Promise<boolean> => {
		if (refusesWrites()) return true;
		if (!ctx.selection.isCrossBlock) return false;
		await handleCrossBlockTypeReplace(ctx, mutationCtx, text);
		return true;
	};

	return {
		handleKeyDown: keydown.handleKeyDown,
		handleCompositionStart: keydown.handleCompositionStart,
		handlePointerDown: pointer.handlePointerDown,
		handlePaste: async (e, replacement) => {
			if (refusesWrites()) {
				e?.preventDefault();
				return true;
			}
			return handleCrossBlockPaste(ctx, mutationCtx, e, replacement);
		},
		handleBeforeInput: async (e) => {
			if (!ctx.selection.isCrossBlock || e.inputType !== 'insertText') return false;
			e.preventDefault();
			return insertText(e.data ?? '');
		},
		insertText,
		performCrossBlockCut: async () => {
			// Declining the delete degrades a reading-mode cut to a copy.
			if (refusesWrites()) return;
			await performCrossBlockDelete(mutationCtx, 'cut');
		}
	};
}
