/**
 * Clipboard handler bodies for TextEditableBlock. The component keeps the
 * oncopy / oncut / onpaste bindings; this factory owns the bodies so the
 * SFC stays focused on render and lifecycle.
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { DocumentGetter, LinkReferenceResolverRef } from '../../../editor-keys';
import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
import type { AmbientCursorIO } from '../../../ambient/ambient-cursor';
import type { CrossBlockHandlers } from '../../../selection/cross-block/dispatch';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { StickyColumnState } from '../../../cursor/sticky-column';
import { normalizeLineEndings, trimTrailingLineEnding } from '../../../core/lines';
import { getInlineContent } from '../../../core/inline/inline-cache';
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

	function onCopy(e: ClipboardEvent): void {
		deps.stickyColumn.reset();
		e.preventDefault();
		// Sync write via e.clipboardData — navigator.clipboard.writeText is async/permission-gated
		// and unreliable in Tauri's wry webview.
		if (writeCrossBlockCopy(e, deps)) return;
		e.clipboardData?.setData('text/plain', getSelectedTextFromRaw());
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		deps.stickyColumn.reset();
		e.preventDefault();

		if (await writeCrossBlockCut(e, deps)) return;

		const selectedText = getSelectedTextFromRaw();
		if (!selectedText) return;
		e.clipboardData?.setData('text/plain', selectedText);

		const selOffsets = deps.cursor.getRawSelection();
		if (selOffsets) {
			const displayText = trimTrailingLineEnding(deps.node.raw);
			const newDisplay = displayText.slice(0, selOffsets.start) + displayText.slice(selOffsets.end);
			deps.blockEdit.updateBlockContent(deps.index, newDisplay + '\n', selOffsets.start);
			deps.setPendingCursor(selOffsets.start);
		}
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (await deps.crossBlock.handlePaste(e)) return;

		deps.stickyColumn.reset();
		e.preventDefault();
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;

		const selectedWidget = deps.widgetSelection.getSelected();
		if (
			selectedWidget !== null &&
			deps.widgetSelection.isSelected(deps.myPath, selectedWidget.sourceStart)
		) {
			const inline = getInlineContent(
				deps.node,
				deps.linkRef?.current,
				deps.linkRef?.signature ?? ''
			).find((n) => isInlineWidget(n, deps.node.raw) && n.start === selectedWidget.sourceStart);
			if (inline) {
				const newRaw =
					deps.node.raw.slice(0, inline.start) + pastedText + deps.node.raw.slice(inline.end);
				deps.blockEdit.updateBlockContent(
					deps.index,
					newRaw,
					selectedWidget.preSelectOffset,
					inline.start + pastedText.length
				);
				deps.widgetSelection.clear();
				return;
			}
		}

		const offset = deps.cursor.getRaw() ?? 0;
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
