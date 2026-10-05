/**
 * Clipboard handler bodies for TextEditableBlock; the component keeps the
 * oncopy/oncut/onpaste bindings.
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { NodeView } from '../../../core/node-views';
import type { DocumentGetter, PasteImageHook } from '../../../editor-keys';
import type { EditorEvents } from '../../../editor-events';
import type { SurfaceBackend } from '../../../cursor/surface-backend';
import type { CrossBlockHandlers } from '../../../selection/cross-block/dispatch';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
import type { PluginActivation } from '../../../schema/plugin-activation';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { CaretMemory } from '../../../cursor/caret-memory';
import {
	createClipboardHandlers,
	type ClipboardCaretIO,
	type ClipboardCopy,
	type ClipboardHandlers,
	type RevealFold
} from '../editable-surface';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { replaceRangeInLeaf } from '../../../tree-operations/leaf-range';
import { replaceSelectedWidget } from './widget-interaction';
import { widgetSpanIn, type WidgetRange } from './widget-adjacency';
import type { RawRange } from '../../../cursor/widget-offset';
import type { Reading } from '../../../schema/reading';
import type { StoredAs } from '../../../schema/stored-as';

export interface TextClipboardDeps {
	get node(): NodeView;
	get index(): number;
	get myPath(): number[];
	/** Local caret reads go through `cursor`; `caret` is the narrower interface the shared
	 *  clipboard code borrows, read here only for the caret undo puts back after a cut. */
	cursor: SurfaceBackend;
	caret: ClipboardCaretIO;
	crossBlock: CrossBlockHandlers;
	events: EditorEvents;
	onPasteImage: PasteImageHook | undefined;
	selection: SelectionState;
	caretMemory: CaretMemory;
	blockEdit: BlockEditActions;
	pasteCoordinator: PasteCommitCoordinator;
	/** The plugins this instance activated, so an unlisted plugin's paste transform stays out. */
	activePlugins: PluginActivation;
	getDoc: DocumentGetter;
	setPendingCursor: (offset: number | null) => void;
	/** Reading mode: cut becomes copy, paste does nothing. The events still fire
	 *  on a non-editable element, so the check lives in the handlers. */
	isReadOnly: () => boolean;
	/** Hide a construct's shown source before a clipboard edit, so cut and paste run
	 *  against a CST that matches the DOM. Null when no source was showing. */
	foldRevealBeforeMutation: () => RevealFold | null;
	/** True while an inline widget on this block is showing its source. */
	isRevealing: () => boolean;
	/** The block's live DOM as raw text, so a copy over an uncommitted edit yields what
	 *  the user sees rather than a stale slice of `node.raw`. */
	readRevealedText: () => string;
	/** How this editor reads its bytes: an unlisted plugin's opener never takes pasted bytes here,
	 *  and a cut is a join its mode decides the cleanup of (live-mode.md § 4.5). */
	get reading(): Reading;
	/** Where the block's bytes are stored, read when a cut writes. */
	storedAs: () => StoredAs;
}

interface SelectedWidget {
	inline: WidgetRange;
	/** Where the caret was before the widget was selected. */
	preSelectOffset: number;
}

export interface TextClipboard extends ClipboardHandlers {
	/** The block's handler for a clipboard event the editor root received: a selected widget clears
	 *  the browser selection, so the event arrives at `<body>`, past the block's own binding. */
	claimRootClipboard(event: ClipboardEvent): void;
}

export function createTextClipboard(deps: TextClipboardDeps): TextClipboard {
	// Null unless a widget on this block is selected and still present in the parsed
	// inline content. Shared by copy, cut, and paste over a widget.
	function selectedWidgetOnThisBlock(): SelectedWidget | null {
		const selected = deps.selection.widgetIn(deps.myPath);
		const inline = selected && widgetSpanIn(deps.node, selected.sourceStart, deps.reading);
		return selected && inline ? { inline, preSelectOffset: selected.preSelectOffset } : null;
	}

	// Copy never mutates, so the widget stays selected.
	function copyWidget(e: ClipboardEvent): ClipboardCopy<SelectedWidget> {
		const widget = selectedWidgetOnThisBlock();
		if (widget === null) return null;
		e.clipboardData?.setData(
			'text/plain',
			deps.node.raw.slice(widget.inline.start, widget.inline.end)
		);
		return { held: widget };
	}

	// The caret sat outside the text while the widget was selected, so undo returns it to where
	// it was before the selection.
	function removeWidget({ inline, preSelectOffset }: SelectedWidget): Promise<void> {
		return replaceSelectedWidget(deps, inline, '', (edit) => {
			const write = deps.blockEdit.updateBlockContent(
				deps.index,
				edit.raw,
				'literal',
				preSelectOffset,
				edit.caret
			);
			if (write.admitted) deps.setPendingCursor(write.caret);
			return write;
		});
	}

	// A selection over a construct whose source is showing covers uncommitted DOM, so slice the
	// live text rather than the stale `node.raw`; the copy must not hide it, because that writes.
	function copyRange(e: ClipboardEvent): ClipboardCopy<RawRange> {
		const range = deps.cursor.getRawSelection();
		if (!range || range.start === range.end) return null;
		const text = deps.isRevealing() ? deps.readRevealedText() : deps.node.raw;
		e.clipboardData?.setData('text/plain', text.slice(range.start, range.end));
		return { held: range };
	}

	// A cut is a delete, so it goes through the same join rules: in live mode the range can span
	// delimiter runs the user never saw, and a plain splice would print them.
	function removeRange(range: RawRange): void {
		const edit = replaceRangeInLeaf(deps.node, range, '', deps.storedAs());
		const write = deps.blockEdit.updateBlockContent(
			deps.index,
			edit.raw,
			'literal',
			deps.caret.getPreEditOffset(),
			edit.caret
		);
		if (write.admitted) deps.setPendingCursor(write.caret);
	}

	const handlers = createClipboardHandlers({
		caretMemory: deps.caretMemory,
		selection: deps.selection,
		getDoc: deps.getDoc,
		crossBlock: deps.crossBlock,
		isReadOnly: deps.isReadOnly,
		caret: deps.caret,
		events: deps.events,
		onPasteImage: deps.onPasteImage,
		foldReveal: deps.foldRevealBeforeMutation,
		selectionArms: [{ copy: copyWidget, remove: removeWidget }],
		rangeArm: { copy: copyRange, remove: removeRange },

		pasteTail: async (pastedText, foldedCaret) => {
			// A selected widget is the selection a paste replaces, through the same route as any.
			const widget = selectedWidgetOnThisBlock();
			if (widget !== null) deps.selection.clearWidget();
			// Once the widget's source is hidden again the caret sits on its element-level edge,
			// where `getRaw` can read null; the committed caret is the right offset.
			const offset = deps.cursor.getRaw() ?? foldedCaret ?? 0;
			const range = widget?.inline ?? deps.cursor.getRawSelection();

			const result = await pasteDispatch(
				{
					pastedText,
					targetPath: deps.myPath,
					offset: range ? range.start : offset,
					preDelete: range ? { start: range.start, end: range.end } : undefined,
					caretBefore: widget?.preSelectOffset
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
