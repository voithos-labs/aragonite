/**
 * Cross-block event dispatch: handlers an editable block, or the editor root, runs at the top of
 * its own event handlers, before its single-block handling.
 */

import type { BlockEditActions } from '../../action-contracts';
import type { BlockElLookup, DocumentGetter } from '../../editor-keys';
import type { UserScrollport } from '../../windowing/scroll-ancestors';
import type { ScrollOwner } from '../../windowing/scroll-owner';
import type { SelectionState } from '../selection-state.svelte';
import type { CaretMemory } from '../../caret/caret-memory';
import type { CaretWriter } from '../../caret/widget-offset';
import type { CaretLanding } from '../caret-landing';
import type { CommitController } from '../../action-contracts';
import type { CommandDispatchContext } from '../../schema/block-commands';
import type { EditorEvents } from '../../editor-events';
import type { Reading } from '../../schema/reading';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import { normalizeLineEndings } from '../../core/lines';
import { isReadingMode } from '../../presentation-mode';
import { replaceRange } from './range-replace';
import { createCrossBlockKeydown } from './keydown';
import { createCrossBlockPointer, type PaddingPress } from './pointer';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockDispatchContext {
	getEl: () => HTMLElement | null;
	getMyPath: () => number[];

	selection: SelectionState;
	/** The editor's caret writer, which every caret and range the dispatch puts down goes through. */
	caretWriter: CaretWriter;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	/** Where a collapse, an extend's parked caret and a command's target block are put down. */
	caretLanding: Pick<CaretLanding, 'restore' | 'park' | 'mount'>;
	getEditorRoot: () => HTMLElement | null;
	/** What autoscrolls a drag-select that reaches an edge: the root, the host's scroller, or the
	 *  window. See `windowing/scroll-ancestors`. */
	getScrollHost: () => UserScrollport | null;
	/** Brings the endpoint a keyboard extend reached to the nearest edge. */
	scrollOwner: Pick<ScrollOwner, 'place'>;
	/** Aborted when the owning editor unmounts. See the document facet's `lifetime`. */
	getEditorLifetime: () => AbortSignal | null;
	caretMemory: CaretMemory;
	blockEdit: BlockEditActions;
	controller: CommitController;
	/** How the editor reads its bytes: the removal's join cleanup and the paste reparse read it. */
	reading: Reading;
	/** The editor's command dispatch, which runs a chord pressed over a range. */
	commands: CommandDispatchContext;
	pasteCoordinator: PasteCommitCoordinator;
	/** The plugins this instance activated, forwarded to the paste hooks. */
	activePlugins: PluginActivation;
	/** The editor's event emitter, the paste handler's only channel for a gesture it consumed but
	 *  could not land. Non-nullable: skipping it drops a paste in silence. */
	events: EditorEvents;
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
	/** Whether `handleBeforeInput` takes `e`, known before it runs: a character typed over a range. */
	claimsBeforeInput(e: InputEvent): boolean;
	handleBeforeInput(e: InputEvent): Promise<boolean>;
	/** A character typed over a range from a caller with no `InputEvent`: the editor root, where a
	 *  range over a block with no character position leaves no element for `beforeinput`. */
	insertText(text: string): Promise<boolean>;
	handleCompositionStart(): boolean;
	/** After the composed text's write, whether or not there was one. */
	handleCompositionEnd(): void;
	/** The delete half of a cut, run once the handler wrote the clipboard synchronously. */
	performCrossBlockCut(): Promise<void>;
}

export function createCrossBlockHandlers(ctx: CrossBlockDispatchContext): CrossBlockHandlers {
	const keydown = createCrossBlockKeydown(ctx);
	const pointer = createCrossBlockPointer(ctx);

	const claimsBeforeInput = (e: InputEvent): boolean =>
		ctx.selection.isCrossBlock && e.inputType === 'insertText';

	const insertText = async (text: string): Promise<boolean> => {
		// Refused quietly here, since the range replace's refusal warns about a key the editor lets
		// through; this check goes once one reading-mode check sits in front of every key handler.
		if (isReadingMode(ctx.reading.mode)) return true;
		if (!ctx.selection.isCrossBlock) return false;
		await replaceRange(ctx, { kind: 'text', text });
		return true;
	};

	return {
		handleKeyDown: keydown.handleKeyDown,
		handleCompositionStart: keydown.handleCompositionStart,
		handleCompositionEnd: keydown.handleCompositionEnd,
		handlePointerDown: pointer.handlePointerDown,
		handlePaste: async (e, replacement) => {
			if (!ctx.selection.isCrossBlock) return false;
			e?.preventDefault();
			// `!== undefined`, not `??`: a caller supplying its own payload must never reach the
			// clipboard read, and `??` would make that depend on callers never passing ''.
			const text =
				replacement !== undefined
					? replacement
					: normalizeLineEndings(e?.clipboardData?.getData('text/plain') ?? '');
			await replaceRange(ctx, { kind: 'paste', text });
			return true;
		},
		claimsBeforeInput,
		handleBeforeInput: async (e) => {
			if (!claimsBeforeInput(e)) return false;
			e.preventDefault();
			return insertText(e.data ?? '');
		},
		insertText,
		performCrossBlockCut: async () => {
			await replaceRange(ctx, { kind: 'none', gesture: 'cut' });
		}
	};
}
