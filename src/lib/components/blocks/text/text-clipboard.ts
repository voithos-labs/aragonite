/**
 * Clipboard handler bodies for TextEditableBlock. The component keeps the
 * oncopy / oncut / onpaste bindings; this factory owns the bodies so the
 * SFC stays focused on render and lifecycle.
 */

import { tick } from 'svelte';
import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { DocumentGetter, LinkReferenceResolverRef } from '../../../editor-keys';
import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
import type { AmbientCursorIO } from '../../../ambient/ambient-cursor';
import type { CrossBlockHandlers } from '../../../selection/cross-block/dispatch';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { StickyColumnState } from '../../../cursor/sticky-column';
import {
	normalizeLineEndings,
	trimTrailingLineEnding,
	trailingLineEnding
} from '../../../core/lines';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { isInlineWidget } from '../../../core/inline/inline-widgets';
import { writeCrossBlockCopy, writeCrossBlockCut } from '../../../selection/cross-block/clipboard';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';

export interface TextClipboardDeps {
	get node(): NodeView;
	get index(): number;
	get myPath(): number[];
	cursor: AmbientCursorIO;
	crossBlock: CrossBlockHandlers;
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
	 *  a CST consistent with the swapped DOM. Returns the committed caret, or null when
	 *  no reveal was open. */
	commitRevealBeforeClipboard: () => number | null;
	/** True while an inline-widget source reveal is active on this block. */
	isRevealing: () => boolean;
	/** The block's live DOM read as raw text (widget-aware) — the reveal-aware copy
	 *  reads it so a selection over the revealed (uncommitted) edit yields what the
	 *  user sees, not the stale raw slice. */
	readRevealedText: () => string;
	get linkRef(): LinkReferenceResolverRef | undefined;
}

export interface TextClipboardHandlers {
	onCopy(e: ClipboardEvent): void;
	onCut(e: ClipboardEvent): Promise<void>;
	onPaste(e: ClipboardEvent): Promise<void>;
}

export function createTextClipboard(deps: TextClipboardDeps): TextClipboardHandlers {
	function getSelectedTextFromRaw(): string {
		const offsets = deps.cursor.getRawSelection();
		if (!offsets) return '';
		return deps.node.raw.slice(offsets.start, offsets.end);
	}

	// A selected inline widget (image, <br>) resolved to its live inline node — the
	// shared resolution behind copy, cut, and paste-over-widget. Null unless a widget
	// on THIS block is selected and still present in the parsed inline content.
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

	function onCopy(e: ClipboardEvent): void {
		deps.stickyColumn.reset();
		e.preventDefault();
		// Reading mode copies what the reader sees: the native selection string,
		// which excludes the CSS-hidden marker spans — not the raw markdown slice.
		if (deps.isReadOnly()) {
			e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
			return;
		}
		// A selected widget copies its own source slice; copy never mutates, so the
		// widget stays selected.
		const widget = selectedWidgetOnThisBlock();
		if (widget !== null) {
			e.clipboardData?.setData(
				'text/plain',
				deps.node.raw.slice(widget.inline.start, widget.inline.end)
			);
			return;
		}
		// Sync write via e.clipboardData — navigator.clipboard.writeText is async/permission-gated
		// and unreliable in Tauri's wry webview.
		if (writeCrossBlockCopy(e, deps)) return;
		// A within-block selection over an ACTIVE reveal shows the uncommitted source
		// edit in the DOM, so slice the live DOM text, not the stale node.raw. This is
		// the READ half of the fold seam cut/paste mutate at — but it sits LAST, not
		// first: cut/paste fold the reveal and then operate on a consistent CST, while
		// copy must never mutate, so it reads the live DOM as the terminal within-block
		// branch (cross-block routed above; a reveal excludes a selected widget).
		if (deps.isRevealing()) {
			const offsets = deps.cursor.getRawSelection();
			e.clipboardData?.setData(
				'text/plain',
				offsets ? deps.readRevealedText().slice(offsets.start, offsets.end) : ''
			);
			return;
		}
		e.clipboardData?.setData('text/plain', getSelectedTextFromRaw());
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		deps.stickyColumn.reset();
		e.preventDefault();

		if (deps.isReadOnly()) {
			onCopy(e);
			return;
		}

		// Fold any live reveal first (the fold collapses the selection, so a
		// cut-during-reveal degrades to a no-op — acceptable; it never corrupts).
		if (deps.commitRevealBeforeClipboard() !== null) await tick();

		// A selected widget: copy its slice, then splice it out as one undoable commit.
		const widget = selectedWidgetOnThisBlock();
		if (widget !== null) {
			const { inline, preSelectOffset } = widget;
			e.clipboardData?.setData('text/plain', deps.node.raw.slice(inline.start, inline.end));
			const newRaw = deps.node.raw.slice(0, inline.start) + deps.node.raw.slice(inline.end);
			void deps.blockEdit.updateBlockContent(deps.index, newRaw, preSelectOffset, inline.start);
			deps.widgetSelection.clear();
			return;
		}

		if (await writeCrossBlockCut(e, deps)) return;

		const selectedText = getSelectedTextFromRaw();
		if (!selectedText) return;
		e.clipboardData?.setData('text/plain', selectedText);

		const selOffsets = deps.cursor.getRawSelection();
		if (selOffsets) {
			const displayText = trimTrailingLineEnding(deps.node.raw);
			const newDisplay = displayText.slice(0, selOffsets.start) + displayText.slice(selOffsets.end);
			void deps.blockEdit.updateBlockContent(
				deps.index,
				newDisplay + trailingLineEnding(deps.node.raw),
				selOffsets.start
			);
			deps.setPendingCursor(selOffsets.start);
		}
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (deps.isReadOnly()) {
			e.preventDefault();
			return;
		}
		// preventDefault before any await, or the native paste fires during the fold
		// tick and corrupts the DOM (parity with onCut's synchronous prevent).
		e.preventDefault();
		const foldedCaret = deps.commitRevealBeforeClipboard();
		if (foldedCaret !== null) await tick();

		if (await deps.crossBlock.handlePaste(e)) return;

		deps.stickyColumn.reset();
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;

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

		// Land caret set and raw mutation in one reactive flush so the re-rendered block positions correctly.
		if (result.inlineCaretOffset !== undefined) {
			deps.setPendingCursor(result.inlineCaretOffset);
		}
	}

	return { onCopy, onCut, onPaste };
}
