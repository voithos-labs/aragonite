/**
 * The contract every rendered block satisfies, plus the special caret values and the marker-prefix
 * shape blocks produce. The editor reaches a block only through this flat interface, so something
 * a block cannot do is a missing optional member, not a kind check upstream;
 * `ContainerBlockComponent` is the stricter version. Each member's docstring states its contract.
 */

import type { DocumentView, NodeView } from './core/node-views';
import type { EditorRects } from './editor-rects';
import type { ChildList } from './reactivity/child-list';
import type { AnyCommandId } from './schema/command-id';

// ── Sentinels ──────────────────────────────────────────────────────────────

declare const cursorEndBrand: unique symbol;
/** Branded `number`: a focus offset meaning "end of content", not a position. */
export type CursorEnd = number & { readonly [cursorEndBrand]: true };

declare const cursorStartBrand: unique symbol;
/** Branded `number`: a focus offset meaning "start of content", not a position. */
export type CursorStart = number & { readonly [cursorStartBrand]: true };

declare const cursorExactStartBrand: unique symbol;
/** Branded `number`: a focus offset meaning "raw byte 0 exactly, unclamped". */
export type CursorExactStart = number & { readonly [cursorExactStartBrand]: true };

declare const selectionEndBrand: unique symbol;
/** Branded `number`: a measurePartialRects endOffset meaning "end of range". */
export type SelectionEnd = number & { readonly [selectionEndBrand]: true };

/**
 * "Place cursor at end of content." Focus handlers fall back to the end of the content when
 * the offset exceeds the block's length, so `MAX_SAFE_INTEGER` always lands there; a smaller
 * fixed number would land mid-block once the content outgrew it.
 */
export const CURSOR_END = Number.MAX_SAFE_INTEGER as CursorEnd;

/**
 * "Place cursor at start of content": the counterpart of {@link CURSOR_END}, and not a synonym
 * for 0. A mode that paints no marker puts raw byte 0 out of the caret's reach behind a leading
 * construct, so a caret arriving here says this and lands on the first offset it can sit at.
 */
export const CURSOR_START = -2 as CursorStart;

/**
 * "Raw byte 0 exactly": the one position `parkCaret` does not clamp. A live split's continuation
 * reopens a construct at byte 0 and typing has to continue inside it (live-mode.md § 4.4), which
 * the clamp would move outside; every other caller wants the clamp (G2.12).
 */
export const CURSOR_EXACT_START = -3 as CursorExactStart;

/** Which child a caret entering a container takes, and the offset handed on to it. */
export interface EntryEdge {
	readonly child: 'first' | 'last';
	readonly offset: number;
	/** The offset was a byte inside the container, not an edge: a container that can map its
	 *  bytes to a child places it there, and any other takes the last child's end. */
	readonly inside: boolean;
}

/**
 * How every container reads a caret offset it is entered with, so a list, a table and a table
 * row agree: 0 and the two start values enter the first child unchanged, and `CURSOR_END` or a
 * byte offset the last child at its end.
 */
export function entryEdge(offset: number): EntryEdge {
	if (offset === 0 || offset === CURSOR_START || offset === CURSOR_EXACT_START) {
		return { child: 'first', offset, inside: false };
	}
	return { child: 'last', offset: CURSOR_END, inside: offset !== CURSOR_END };
}

/**
 * "End of this block's measurable range" for `measurePartialRects`' `endOffset`. Each
 * block reads it in its own coordinate system: text falls through to the browser's range
 * clamping, `TableBlock` matches it explicitly to reach the last cell.
 */
export const SELECTION_END = Number.MAX_SAFE_INTEGER as SelectionEnd;

// ── Helper types ───────────────────────────────────────────────────────────

/**
 * Direction the cursor is entering a block from for sticky-column moves.
 * `'above'` = downward move; `'below'` = upward move.
 */
export type StickyColumnDirection = 'above' | 'below';

/**
 * Focus position for moveFocus. The sticky-column variant aligns to the current sticky
 * X on the target's first/last visual line, falling back to focus(0) / focus(CURSOR_END).
 */
export type FocusPosition = 'start' | 'end' | number | { stickyColumnFrom: StickyColumnDirection };

// ── The container's marker prefix ──────────────────────────────────────────

/** A focusable range must say what Enter and Space do, so a tab stop is never a dead key. */
export type AmbientInteractiveRange = AmbientRangeBase &
	(
		| {
				/** Gives the span a tab stop. Decide by mode: a stop inside an editable block
				 *  interrupts the caret's Tab, so the footnote marker takes one in reading mode only. */
				focusable: true;
				/** Enter or Space on the focused span. */
				onActivate: () => void;
		  }
		| { focusable?: false; onActivate?: () => void }
	);

interface AmbientRangeBase {
	start: number;
	end: number;
	className: string;
	role?: 'checkbox' | 'link' | 'button';
	ariaChecked?: boolean;
	/** The span's accessible name, rendered as `aria-label`. */
	label?: string;
	/** The block's drag handle centres on this span's box rather than on its text line. */
	dragAnchor?: boolean;
	/** The click lands on the range's own span, before the leaf's caret handling; a handler
	 *  reading the chord (`isWidgetActivationClick`) stops propagation to keep the gesture. */
	onClick: (e: MouseEvent) => void;
}

export type AmbientPrefix =
	| string
	| {
			text: string;
			interactive?: AmbientInteractiveRange[];
			/**
			 * The hanging indent the rendered prefix needs, when its painted width is not its text
			 * width (a task item's `- [ ] ` paints as one box). Defaults to one `ch` per character.
			 */
			indent?: string;
	  };

// ── BlockComponentProps ──────────────────────────────────────────────────────

/**
 * The props BlockHost passes every block component; a registry `extraProps` may add
 * kind-specific ones. A component may declare a subset, since Svelte ignores props it
 * omits, but a leaf that drops `ambientPrefix` visually deletes its markers.
 */
export interface BlockComponentProps {
	/** Bytes-readonly view: components render the CST, and mutation goes through actions (G1.9). */
	node: NodeView;
	index: number;
	myPath: number[];
	/** Container-contributed read-only prefix rendered before the block's own raw (a list item's `- `). */
	ambientPrefix: AmbientPrefix;
	/** The root document, readonly by type; changing it is the commit path's business. */
	document?: DocumentView;
	/** The owning instance's `EditorRects`: measure, scroll into view, or scroll to a path.
	 *  The live object, so a block navigating to another shares the editor's one copy. */
	rects?: EditorRects;
}

// ── BlockComponent ─────────────────────────────────────────────────────────

export interface BlockComponent {
	/**
	 * Place the caret at `offset`, focus the element, and end whatever the editor had selected (a
	 * cross-block range, a gap caret, an image selected whole): the safe default over
	 * {@link parkCaret}, since ending it batches with placing the caret. Also
	 * takes the four special caret values above, which stay internal (none is on
	 * `@voithos-labs/aragonite/plugin`). Clamping is required; never throw.
	 */
	focus(offset: number): void;
	/**
	 * `focus` without the range-ending: place the caret and touch nothing else. For paths that only
	 * extend a selection, where a `focus` would cancel the range still being grown (G2.12).
	 */
	parkCaret?(offset: number): void;
	/**
	 * Caret position as a raw offset into this block's own bytes: the container's marker
	 * prefix excluded, a widget counted as the source bytes it stands for. `null`, never 0,
	 * means the caret is not in this block; dispatch checks each ref to find the focused one.
	 */
	getCursorOffset(): number | null;
	/**
	 * The current selection's rendered text, or `''` when unmounted or nothing is selected.
	 * Not clipped to this block: a cross-block selection returns the whole range. Rendered
	 * text, not raw bytes; a caller that needs this block's bytes slices `raw`.
	 */
	getSelectedText?(): string;
	/**
	 * Select `[start, end)` in the same raw-offset space `getCursorOffset` returns, ending whatever
	 * the editor had selected first, as `focus` does. A no-op when the block is unmounted or the
	 * range doesn't resolve.
	 */
	setSelection?(start: number, end: number): void;
	/**
	 * Position the cursor at the offset nearest editor-relative pixel X on the first
	 * (`'above'`) or last (`'below'`) visual line that can show a caret; callers fall back to `focus(0)` or
	 * `CURSOR_END` when a block omits it. Behaves like {@link parkCaret}: it does not end a
	 * live cross-block range, which vertical movement can never reach.
	 */
	focusAtColumn?(x: number, from: StickyColumnDirection): void;
	/** Cascade focus down a path of child indices to reach a leaf at the given offset. */
	focusByPath?(path: number[], offset: number): void;
	/**
	 * Apply this block's own snap for a viewport point inside its box, once the caret has been
	 * placed. A caret that fell at the edge of an inline widget has nothing to draw there, so
	 * the prose block moves it onto the edge and paints the indicator Chromium leaves out; one
	 * that landed in real text is left alone. Omitted by blocks with no such snap.
	 */
	snapCaretToPoint?(clientX: number, clientY: number): void;
	/**
	 * A click beside the block (the editor's margin, the host's own padding) that may become a
	 * drag: start the block's own drag from the leaf nearest the point, a table's cell rectangle
	 * for instance, exactly as a click on that leaf would. True when it did; false leaves the
	 * click to the editor's generic drag.
	 */
	startDragAtPoint?(clientX: number, clientY: number, event: PointerEvent): boolean;
	/**
	 * This block's children as the editor walks down to one: their refs, the render window that
	 * mounts them, and the collapse a navigation may open. Containers, tables and rows have one.
	 */
	childList?(): ChildList;
	/**
	 * Deep cursor position for blocks with nested blocks inside (table cells): the path from
	 * this block to the leaf holding the cursor, plus the offset in it. Preferred over
	 * getCursorOffset by getSelection() when implemented.
	 */
	getCursorPosition?(): { path: number[]; offset: number } | null;
	/**
	 * Viewport-space rects covering [startOffset, endOffset) in this block's visible
	 * text, for cross-block selection painting. Accepts `SELECTION_END` as `endOffset`,
	 * which each block reads in its own coordinate system.
	 */
	measurePartialRects?(startOffset: number, endOffset: number): DOMRect[];
	/**
	 * Viewport-space rect of a single cell by row and column: whole-cell highlighting in a
	 * grid, skipping `measurePartialRects`' selection-aware range logic. Null when the cell
	 * isn't mounted or the coordinate is out of range.
	 */
	cellRect?(rowIdx: number, colIdx: number): DOMRect | null;
	/**
	 * The mounted row range `[start, end)` of a grid that windows its rows. Overlays read it
	 * reactively so a repaint fires once the new rows are committed; rows outside the range
	 * cannot paint until they mount.
	 */
	mountedRowWindow?(): { start: number; end: number };
	/**
	 * True when vertical movement should pass straight through: no text positions the caret
	 * can sit at, only widgets with no column meaning. Decided from the CST, not from mounted
	 * refs, so a container answers the same for a child that is not mounted.
	 */
	isVerticallyTransparent?(): boolean;
	/**
	 * Enter a widget at the block's edge instead of placing a caret beside it. What "enter"
	 * means belongs to the kind's registered `InlineWidgetEditingPolicy`, an open set of
	 * behaviours rather than a yes-or-no choice. False falls through to `focus(0)`/`CURSOR_END`.
	 */
	enterEdgeWidget?(side: 'start' | 'end'): boolean;
	/**
	 * Run a named block-local command resolved from a keybinding. `arg` passes the binding's
	 * fixed argument as `unknown`, so the handler must check its shape and ignore anything
	 * unexpected. False lets the caller fall through to later keydown branches.
	 */
	runCommand?(id: AnyCommandId, arg?: unknown): boolean;
	/**
	 * Whether the command's toggle reads on at this block's own caret or selection: the read
	 * a toolbar paints a pressed state from. Absent, or an id with no toggle state, reads
	 * inactive.
	 */
	isCommandActive?(id: AnyCommandId): boolean;
	/**
	 * Run `run` once this block's shown widget source, which lives in the DOM only, is written
	 * back. A block that never shows one omits it; a command from outside the block waits on it.
	 */
	afterSourceCommit?(run: () => void): void;
	/**
	 * Current raw-offset selection in an editable leaf, a collapsed caret as
	 * `{start: n, end: n}`. Captured before a right-click menu steals focus.
	 */
	getSelectionOffsets?(): { start: number; end: number } | null;
	/**
	 * Take a copy, cut or paste the editor root received because a selection this block owns
	 * puts no caret in the DOM: a selected inline widget in a block with no text position
	 * leaves the browser's selection empty, so the event fires at `<body>`. Taking it always
	 * succeeds once the root has picked this block, so there is nothing to report back: the
	 * root offers the event to one block only, and never offers it elsewhere.
	 */
	claimRootClipboard?(event: ClipboardEvent): void;
	/**
	 * Insert markdown at this block's caret exactly as pasting it would, minus the clipboard:
	 * the block half of `EditorInstance.insertMarkdown`. Return a promise that resolves once
	 * the insert has landed, so the editor can keep it in the undo entry of the gesture that
	 * asked for it; a plain true means only that the text was taken.
	 * Omitted by non-editable blocks.
	 */
	insertMarkdown?(md: string): boolean | Promise<boolean>;
	/**
	 * Type `text` at raw `offset` as a keystroke would: the write a typed character makes, with the
	 * name a new block kind gets and the line an on-type completer finishes. The editor calls it
	 * for a character typed over a range, once the range is removed. Resolves once it lands.
	 * Omitted by non-editable blocks.
	 */
	typeText?(text: string, offset: number): Promise<boolean>;
	/**
	 * Run a clipboard action from the table cell's right-click menu against the offsets
	 * captured at menu-open (focus/selection may have moved since).
	 */
	applyMenuClipboard?(
		action: 'cut' | 'copy' | 'paste',
		sel: { start: number; end: number }
	): Promise<void>;
	/**
	 * Whether this component's own element takes text input: a report, never something the
	 * editor acts on. The kind descriptor's `editable` is the declaration and the only flag
	 * the editor tests (merge eligibility, search scanning); this mirrors it once mounted.
	 */
	readonly editable: boolean;
	/** Whether focus may land on this block at all. This is the flag focus dispatch reads. */
	readonly focusable: boolean;
}

// ── What a component publishes ─────────────────────────────────────────────

/**
 * Every member a container must provide, promoted to required: a caret entering a container
 * has to descend into it, so the descent methods are not "implement if you can" the way a
 * leaf's optional ones are. `createContainerBlockComponent` returns this.
 */
export type ContainerBlockComponent = BlockComponent &
	Required<
		Pick<
			BlockComponent,
			| 'getCursorPosition'
			| 'focusByPath'
			| 'childList'
			| 'focusAtColumn'
			| 'isVerticallyTransparent'
			| 'enterEdgeWidget'
			| 'parkCaret'
		>
	>;

/** A leaf's `blockApi`: every optional `BlockComponent` member the factory implements is required,
 *  so none drops out unseen, and a caller reaches each one without a guard. */
export type EditableLeafBlockApi = BlockComponent &
	Required<
		Pick<
			BlockComponent,
			| 'parkCaret'
			| 'focusAtColumn'
			| 'getSelectedText'
			| 'setSelection'
			| 'measurePartialRects'
			| 'insertMarkdown'
			| 'typeText'
			| 'afterSourceCommit'
		>
	>;

/**
 * What a mounted block component publishes through `bind:this`: a hand-built leaf its members
 * themselves, a component built on the editable leaf its `blockApi`, a container its
 * `containerApi`. Svelte 5 instance exports have no spread, so the factories hand over one object
 * rather than a dozen members to copy by hand. A component publishing none of the three, or a
 * container publishing only a leaf's members, fails where `defineBlockComponent` registers it.
 */
export type BlockComponentExports =
	| BlockComponent
	| { readonly blockApi: EditableLeafBlockApi }
	| { readonly containerApi: ContainerBlockComponent };

/**
 * The `BlockComponent` behind a published instance: the one place that knows a factory's object
 * sits under `blockApi` or `containerApi`. Returns the object it was handed, never a wrapper,
 * because `publishRefSlot` compares identity and a new object would overwrite the stored one.
 */
export function resolveBlockSurface(
	exports: BlockComponentExports | undefined
): BlockComponent | undefined {
	if (!exports) return undefined;
	if ('blockApi' in exports) return exports.blockApi;
	return 'containerApi' in exports ? exports.containerApi : exports;
}
