/**
 * Clipboard handler bodies for TextEditableBlock; the component keeps the
 * oncopy/oncut/onpaste bindings.
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { DocumentGetter, PasteImageHook } from '../../../editor-keys';
import type { EditorEvents } from '../../../editor-events';
import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
import type { AmbientCursorIO } from '../../../ambient/ambient-cursor';
import type { CrossBlockHandlers } from '../../../selection/cross-block/dispatch';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
import type { PluginActivation } from '../../../schema/plugin-activation';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { StickyColumnState } from '../../../cursor/sticky-column';
import type { EdgeAffinityState } from '../../../cursor/edge-affinity';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { isInlineWidget } from '../../../core/inline/inline-widgets';
import {
	createClipboardHandlers,
	type ClipboardCaretIO,
	type ClipboardHandlers,
	type RevealFold
} from '../editable-surface';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { replaceRangeRaw } from './live-selection-edit';
import { replaceSelectedWidget } from './widget-interaction';
import type { Reading } from '../../../schema/reading';
import { documentLineEnding } from '../../../core/lines';

export interface TextClipboardDeps {
	get node(): NodeView;
	get index(): number;
	get myPath(): number[];
	/** Local caret reads go through `cursor`; `caret` is the narrower interface the shared
	 *  clipboard code anchors an image insertion with, passed through and never read here. */
	cursor: AmbientCursorIO;
	caret: ClipboardCaretIO;
	crossBlock: CrossBlockHandlers;
	events: EditorEvents;
	onPasteImage: PasteImageHook | undefined;
	selection: SelectionState;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	blockEdit: BlockEditActions;
	pasteCoordinator: PasteCommitCoordinator;
	/** The plugins this instance activated, so an unlisted plugin's paste transform stays out. */
	activePlugins: PluginActivation;
	getDoc: DocumentGetter;
	widgetSelection: WidgetSelectionState;
	setPendingCursor: (offset: number | null) => void;
	/** Reading mode: cut becomes copy, paste does nothing. The events still fire
	 *  on a non-editable element, so the check lives in the handlers. */
	isReadOnly: () => boolean;
	/** Hide a construct's shown source before a clipboard edit, so cut and paste run
	 *  against a CST that matches the DOM. Null when no source was showing. */
	foldRevealBeforeMutation: () => RevealFold | null;
	/** True while an inline widget on this block is showing its source. */
	isRevealing: () => boolean;
	/** The container's marker prefix this block renders under, which the cut reads its candidate
	 *  back through: a list item body left starting with a space reparses under a wider marker. */
	getAmbientPrefix: () => string;
	/** The block's live DOM as raw text, so a copy over an uncommitted edit yields what
	 *  the user sees rather than a stale slice of `node.raw`. */
	readRevealedText: () => string;
	/** How this editor reads its bytes: an unlisted plugin's opener never takes pasted bytes here,
	 *  and a cut is a join its mode decides the cleanup of (live-mode.md § 4.5). */
	get reading(): Reading;
}

export interface TextClipboard extends ClipboardHandlers {
	/**
	 * The block's own handler for a copy, cut or paste the editor root received: selecting a
	 * widget clears the browser selection, so a block with no text position for a caret gets its
	 * events at `<body>`, where no block's own binding sees them.
	 */
	claimRootClipboard(event: ClipboardEvent): void;
}

export function createTextClipboard(deps: TextClipboardDeps): TextClipboard {
	function getSelectedTextFromRaw(): string {
		const offsets = deps.cursor.getRawSelection();
		if (!offsets) return '';
		return deps.node.raw.slice(offsets.start, offsets.end);
	}

	// Null unless a widget on this block is selected and still present in the parsed
	// inline content. Shared by copy, cut, and paste over a widget.
	function selectedWidgetOnThisBlock(): {
		inline: ReturnType<typeof resolvedInlineContent>[number];
		preSelectOffset: number;
	} | null {
		const selected = deps.widgetSelection.getSelected();
		if (selected === null || !deps.widgetSelection.isSelected(deps.myPath, selected.sourceStart)) {
			return null;
		}
		const inline = resolvedInlineContent(deps.node, deps.reading).find(
			(n) =>
				isInlineWidget(n, deps.node.raw, deps.reading.grammar) && n.start === selected.sourceStart
		);
		return inline ? { inline, preSelectOffset: selected.preSelectOffset } : null;
	}

	const handlers = createClipboardHandlers({
		stickyColumn: deps.stickyColumn,
		edgeAffinity: deps.edgeAffinity,
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

		// A selection over a construct whose source is showing covers uncommitted DOM, so slice
		// the live text rather than the stale `node.raw`; copy must not hide it, because that writes.
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
			void replaceSelectedWidget(deps, inline, preSelectOffset, '');
			return true;
		},

		cutTail: (e) => {
			const selectedText = getSelectedTextFromRaw();
			if (!selectedText) return;
			e.clipboardData?.setData('text/plain', selectedText);

			const selOffsets = deps.cursor.getRawSelection();
			if (!selOffsets) return;
			// A cut is a delete, so it goes through the same join rules: in live mode the range
			// can span delimiter runs the user never saw, and a plain splice would print them.
			const edit = replaceRangeRaw(
				deps.node,
				selOffsets,
				'',
				deps.reading,
				deps.getAmbientPrefix(),
				documentLineEnding(deps.getDoc())
			);
			void deps.blockEdit.updateBlockContent(deps.index, edit.raw, selOffsets.start);
			deps.setPendingCursor(edit.caret);
		},

		pasteTail: async (pastedText, foldedCaret) => {
			const widget = selectedWidgetOnThisBlock();
			if (widget !== null) {
				await replaceSelectedWidget(deps, widget.inline, widget.preSelectOffset, pastedText);
				return;
			}

			// Once the widget's source is hidden again the caret sits on its element-level edge,
			// where `getRaw` can read null; the committed caret is the right offset.
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
					controller: deps.pasteCoordinator,
					reading: deps.reading,
					activePlugins: deps.activePlugins
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
		// Routed to the same handlers a caret-side event reaches, so the reading-mode check, the
		// source hide and the sticky-column reset come along rather than being repeated here.
		claimRootClipboard(event) {
			if (selectedWidgetOnThisBlock() === null) return;
			if (event.type === 'copy') handlers.onCopy(event);
			else if (event.type === 'cut') void handlers.onCut(event);
			else if (event.type === 'paste') void handlers.onPaste(event);
		}
	};
}
