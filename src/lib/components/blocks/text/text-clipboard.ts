/**
 * The clipboard of a block whose text takes inline constructs, a paragraph's or a table cell's: a
 * selected widget, then the block's own range, on the surface's shared steps. The component keeps
 * the oncopy/oncut/onpaste bindings.
 */

import type { NodeView } from '../../../core/node-views';
import type { SurfaceBackend } from '../editable/surface-backend';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { EditableSurface } from '../editable/editable-surface';
import type { BlockClipboard, ClipboardHandlers, RevealFold } from '../editable/surface-clipboard';
import type { ClipboardCopy } from '../editable/clipboard-step';
import { bytesLeavingLeaf, replaceRangeInLeaf } from '../../../tree-operations/leaf-range';
import { replaceSelectedWidget } from './widget-interaction';
import { widgetSpanIn, type WidgetRange } from './widget-adjacency';
import type { RawRange } from '../../../caret/widget-offset';
import type { Reading } from '../../../schema/reading';
import type { StoredAs } from '../../../schema/stored-as';

export interface TextClipboardDeps {
	get node(): NodeView;
	get index(): number;
	get myPath(): number[];
	/** Local caret reads go through `cursor`; the surface's `caret` is read only for the caret
	 *  undo puts back after a cut. */
	cursor: SurfaceBackend;
	surface: Pick<EditableSurface, 'clipboard' | 'pasteInline' | 'caret' | 'blockEdit'>;
	selection: SelectionState;
	setPendingCursor: (offset: number | null) => void;
	/** Close a widget's shown source before a cut or paste, so it lands in the rendered block.
	 *  Null when no source was showing. */
	foldRevealBeforeMutation: () => RevealFold | null;
	/** How this editor reads its bytes: which widgets the block holds, and the join rules a cut
	 *  takes (live-mode.md § 4.5). */
	get reading(): Reading;
	/** Where the block's bytes are stored, read when a cut writes. */
	storedAs: () => StoredAs;
	/** A paste step the block takes before any other: a table cell fills cells from a pasted grid. */
	pastePreHook?: BlockClipboard['pastePreHook'];
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
			const write = deps.surface.blockEdit.updateBlockContent(
				deps.index,
				edit.raw,
				'literal',
				'join-typing',
				preSelectOffset,
				edit.caret
			);
			if (write.admitted) deps.setPendingCursor(write.caret);
			return write;
		});
	}

	// The copy carries what a cut takes, so a paste gives back what was cut.
	function copyRange(e: ClipboardEvent): ClipboardCopy<RawRange> {
		const range = deps.cursor.getRawSelection();
		if (!range || range.start === range.end) return null;
		const carried = bytesLeavingLeaf(deps.node, range, deps.storedAs());
		e.clipboardData?.setData('text/plain', carried);
		return { held: range };
	}

	// A cut is a delete, so it goes through the same join rules: in live mode the range can span
	// delimiter runs the user never saw, and a plain splice would print them.
	function removeRange(range: RawRange): void {
		const edit = replaceRangeInLeaf(deps.node, range, '', deps.storedAs());
		const write = deps.surface.blockEdit.updateBlockContent(
			deps.index,
			edit.raw,
			'literal',
			'join-typing',
			deps.surface.caret.getPreEditOffset(),
			edit.caret
		);
		if (write.admitted) deps.setPendingCursor(write.caret);
	}

	const handlers = deps.surface.clipboard({
		foldReveal: deps.foldRevealBeforeMutation,
		selectionArms: [{ copy: copyWidget, remove: removeWidget }],
		rangeArm: { copy: copyRange, remove: removeRange },
		pastePreHook: deps.pastePreHook,
		pasteTail: (pastedText, { range, held }) => {
			// A selected widget is the selection a paste replaces, through the same route as any.
			const widget = selectedWidgetOnThisBlock();
			if (widget !== null) deps.selection.clearWidget();
			const replaced = widget?.inline ?? (range && range.start < range.end ? range : null);
			return deps.surface.pasteInline({
				pastedText,
				// Placed across a hidden edge by `held.spend`, as every insertion is.
				offset: replaced ? replaced.start : (range?.start ?? 0),
				preDelete: replaced ? { start: replaced.start, end: replaced.end } : undefined,
				caretBefore: widget?.preSelectOffset ?? deps.surface.caret.getPreEditOffset(),
				spend: held.spend
			});
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
