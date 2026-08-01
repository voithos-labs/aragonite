/**
 * Clipboard handler bodies for TextEditableBlock; the component keeps the
 * oncopy/oncut/onpaste bindings.
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type {
	DocumentGetter,
	LinkReferenceResolverRef,
	PasteImageHook
} from '../../../editor-keys';
import type { EditorEvents } from '../../../editor-events';
import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
import type { AmbientCursorIO } from '../../../ambient/ambient-cursor';
import type { CrossBlockHandlers } from '../../../selection/cross-block/dispatch';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { StickyColumnState } from '../../../cursor/sticky-column';
import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { isInlineWidget } from '../../../core/inline/inline-widgets';
import {
	createClipboardHandlers,
	type ClipboardCaretIO,
	type ClipboardHandlers,
	type RevealFold
} from '../editable-surface';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';

export interface TextClipboardDeps {
	get node(): NodeView;
	get index(): number;
	get myPath(): number[];
	/** Local caret reads go through `cursor`; `caret` is the narrower door the shared
	 *  clipboard seam anchors an image insertion with, a passthrough never read here. */
	cursor: AmbientCursorIO;
	caret: ClipboardCaretIO;
	crossBlock: CrossBlockHandlers;
	events: EditorEvents;
	onPasteImage: PasteImageHook | undefined;
	selection: SelectionState;
	stickyColumn: StickyColumnState;
	blockEdit: BlockEditActions;
	pasteCoordinator: PasteCommitCoordinator;
	getDoc: DocumentGetter;
	widgetSelection: WidgetSelectionState;
	setPendingCursor: (offset: number | null) => void;
	/** Reading mode: cut degrades to copy, paste is inert. The events still fire
	 *  on a non-editable surface, so the gate lives in the handlers. */
	isReadOnly: () => boolean;
	/** Fold a live source-reveal before a clipboard mutation, so cut/paste run against
	 *  a CST consistent with the swapped DOM. Null when no reveal was open. */
	foldRevealBeforeMutation: () => RevealFold | null;
	/** True while an inline-widget source reveal is active on this block. */
	isRevealing: () => boolean;
	/** The block's live DOM as raw text, so a copy over a revealed (uncommitted) edit
	 *  yields what the user sees rather than the stale raw slice. */
	readRevealedText: () => string;
	get linkRef(): LinkReferenceResolverRef | undefined;
}

export interface TextClipboard extends ClipboardHandlers {
	/**
	 * The block's own handler for a copy/cut/paste the editor root received. A selected
	 * widget clears the native selection, so in a block with no text position for a caret to
	 * survive in the browser dispatches at `<body>` and no surface binding sees it. False
	 * when no widget of this block is selected — the root seam's cue to keep looking.
	 */
	claimRootClipboard(event: ClipboardEvent): boolean;
}

export function createTextClipboard(deps: TextClipboardDeps): TextClipboard {
	function getSelectedTextFromRaw(): string {
		const offsets = deps.cursor.getRawSelection();
		if (!offsets) return '';
		return deps.node.raw.slice(offsets.start, offsets.end);
	}

	// Null unless a widget on THIS block is selected and still present in the parsed
	// inline content. Shared by copy, cut, and paste-over-widget.
	function selectedWidgetOnThisBlock(): {
		inline: ReturnType<typeof resolvedInlineContent>[number];
		preSelectOffset: number;
	} | null {
		const selected = deps.widgetSelection.getSelected();
		if (selected === null || !deps.widgetSelection.isSelected(deps.myPath, selected.sourceStart)) {
			return null;
		}
		const inline = resolvedInlineContent(deps.node, deps.linkRef).find(
			(n) => isInlineWidget(n, deps.node.raw) && n.start === selected.sourceStart
		);
		return inline ? { inline, preSelectOffset: selected.preSelectOffset } : null;
	}

	const handlers = createClipboardHandlers({
		stickyColumn: deps.stickyColumn,
		selection: deps.selection,
		getDoc: deps.getDoc,
		crossBlock: deps.crossBlock,
		isReadOnly: deps.isReadOnly,
		caret: deps.caret,
		events: deps.events,
		onPasteImage: deps.onPasteImage,
		foldReveal: deps.foldRevealBeforeMutation,

		// Copy never mutates, so the widget stays selected.
		copyPreHook: (e) => {
			const widget = selectedWidgetOnThisBlock();
			if (widget === null) return false;
			e.preventDefault();
			e.clipboardData?.setData(
				'text/plain',
				deps.node.raw.slice(widget.inline.start, widget.inline.end)
			);
			return true;
		},

		// A selection over an ACTIVE reveal covers uncommitted DOM, so slice the live text
		// rather than the stale `node.raw`; copy must not fold, because folding mutates.
		copyTail: (e) => {
			e.preventDefault();
			if (deps.isRevealing()) {
				const offsets = deps.cursor.getRawSelection();
				e.clipboardData?.setData(
					'text/plain',
					offsets ? deps.readRevealedText().slice(offsets.start, offsets.end) : ''
				);
				return;
			}
			e.clipboardData?.setData('text/plain', getSelectedTextFromRaw());
		},

		// A selected widget: copy its slice, then splice it out as one undoable commit.
		cutPreHook: (e) => {
			const widget = selectedWidgetOnThisBlock();
			if (widget === null) return false;
			const { inline, preSelectOffset } = widget;
			e.clipboardData?.setData('text/plain', deps.node.raw.slice(inline.start, inline.end));
			const newRaw = deps.node.raw.slice(0, inline.start) + deps.node.raw.slice(inline.end);
			void deps.blockEdit.updateBlockContent(deps.index, newRaw, preSelectOffset, inline.start);
			deps.widgetSelection.clear();
			return true;
		},

		cutTail: (e) => {
			const selectedText = getSelectedTextFromRaw();
			if (!selectedText) return;
			e.clipboardData?.setData('text/plain', selectedText);

			const selOffsets = deps.cursor.getRawSelection();
			if (selOffsets) {
				const displayText = trimTrailingLineEnding(deps.node.raw);
				const newDisplay =
					displayText.slice(0, selOffsets.start) + displayText.slice(selOffsets.end);
				void deps.blockEdit.updateBlockContent(
					deps.index,
					newDisplay + trailingLineEnding(deps.node.raw),
					selOffsets.start
				);
				deps.setPendingCursor(selOffsets.start);
			}
		},

		pasteTail: async (e, pastedText, foldedCaret) => {
			const widget = selectedWidgetOnThisBlock();
			if (widget !== null) {
				const { inline, preSelectOffset } = widget;
				const newRaw =
					deps.node.raw.slice(0, inline.start) + pastedText + deps.node.raw.slice(inline.end);
				void deps.blockEdit.updateBlockContent(
					deps.index,
					newRaw,
					preSelectOffset,
					inline.start + pastedText.length
				);
				deps.widgetSelection.clear();
				return;
			}

			// After a reveal fold the caret sits on the widget's element-level edge, where
			// getRaw can read null; the committed caret is the correct landing offset.
			const offset = deps.cursor.getRaw() ?? foldedCaret ?? 0;
			const selOffsets = deps.cursor.getRawSelection();

			const result = await pasteDispatch(
				{
					pastedText,
					targetPath: deps.myPath,
					offset: selOffsets ? selOffsets.start : offset,
					preDelete: selOffsets ? { start: selOffsets.start, end: selOffsets.end } : undefined
				},
				{
					doc: deps.getDoc(),
					blockEdit: deps.blockEdit,
					controller: deps.pasteCoordinator
				}
			);

			// Pending, so the caret set and the raw mutation land in one reactive flush.
			if (result.inlineCaretOffset !== undefined) {
				deps.setPendingCursor(result.inlineCaretOffset);
			}
		}
	});

	return {
		...handlers,
		// Routed to the same arms the caret route reaches, so the reading gate, the reveal
		// fold and the sticky reset come along rather than being re-carried here.
		claimRootClipboard(event) {
			if (selectedWidgetOnThisBlock() === null) return false;
			if (event.type === 'copy') handlers.onCopy(event);
			else if (event.type === 'cut') void handlers.onCut(event);
			else if (event.type === 'paste') void handlers.onPaste(event);
			else return false;
			return true;
		}
	};
}
