/**
 * The view-layer contract every rendered block satisfies, plus the cursor sentinels and
 * ambient-prefix shape blocks produce. Orchestration reaches a block only through this
 * interface, so a capability a block lacks is an omitted optional member rather than a kind
 * check upstream. Authoritative for external authors: each member's docstring states its
 * contract. Members stay flat: the caret members' three layers (landing doors, point
 * resolution, boundary policy) are documentation, in docs/design/editor.md § The editing
 * surface, and `ContainerBlockComponent` is the one promoted tier.
 */

import type { DocumentView, NodeView } from './core/node-views';
import type { EditorRects } from './editor-rects';

// ── Sentinels ──────────────────────────────────────────────────────────────

declare const cursorEndBrand: unique symbol;
/** Branded `number`: a focus offset meaning "end of content", not a position. */
export type CursorEnd = number & { readonly [cursorEndBrand]: true };

declare const cursorStartBrand: unique symbol;
/** Branded `number`: a focus offset meaning "start of content", not a position. */
export type CursorStart = number & { readonly [cursorStartBrand]: true };

declare const selectionEndBrand: unique symbol;
/** Branded `number`: a measurePartialRects endOffset meaning "end of range". */
export type SelectionEnd = number & { readonly [selectionEndBrand]: true };

/**
 * "Place cursor at end of content." Focus walkers fall through to their end-of-content
 * fallback when the offset exceeds the block's length, so MAX_SAFE_INTEGER always lands
 * there — a finite sentinel lands mid-block once content outgrows it.
 */
export const CURSOR_END = Number.MAX_SAFE_INTEGER as CursorEnd;

/**
 * "Place cursor at start of content" — {@link CURSOR_END}'s twin, and NOT a synonym for 0. A
 * mode that paints no marker puts raw 0 out of the caret's reach behind a leading construct, so
 * an ARRIVAL says this and the door seats it on the first landable offset; a caller passing 0
 * means byte 0 and keeps it (a split's continuation is the reason that distinction exists).
 */
export const CURSOR_START = -2 as CursorStart;

/** Cascade focus to the last descendant and place the cursor at its start. */
export const FOCUS_LAST_START = -1;

/**
 * "End of this block's measurable range" for measurePartialRects' endOffset. Each
 * surface interprets it in its own coordinate system: text falls through to native
 * range clamping, TableBlock matches it explicitly to reach the last cell.
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

// ── Ambient prefix ─────────────────────────────────────────────────────────

export interface AmbientInteractiveRange {
	start: number;
	end: number;
	className: string;
	role?: 'checkbox';
	ariaChecked?: boolean;
	onClick: () => void;
}

export type AmbientPrefix = string | { text: string; interactive?: AmbientInteractiveRange[] };

// ── BlockComponentProps ──────────────────────────────────────────────────────

/**
 * The props BlockHost passes every block component; a registry `extraProps` may add
 * kind-specific ones. A component may declare a subset — Svelte ignores props it omits,
 * but a leaf that drops `ambientPrefix` visually deletes its markers.
 */
export interface BlockComponentProps {
	/** Bytes-readonly view (G1.9): components render the CST; mutation routes through actions. */
	node: NodeView;
	index: number;
	myPath: number[];
	/** Container-contributed read-only prefix rendered before the block's own raw (a list item's `- `). */
	ambientPrefix: AmbientPrefix;
	/** The root document, readonly by type — mutation stays a commit-ceremony concern. */
	document?: DocumentView;
	/** The owning instance's rect surface: measure/reveal/scroll by path. The live
	 *  instance object, so a block navigating to another shares the editor's one seam. */
	rects?: EditorRects;
}

// ── BlockComponent ─────────────────────────────────────────────────────────

export interface BlockComponent {
	/**
	 * Place the caret at `offset`, focusing the surface, and end any live cross-block
	 * range — the safe default door. `CURSOR_END` and `FOCUS_LAST_START` (`-1`) arrive
	 * through this same `number`; an out-of-range offset must clamp, never throw.
	 * Implement by minting `selection/caret-doors.ts`' `placeCaret` over {@link parkCaret},
	 * never by hand: the range-ending has to be batched with the landing.
	 */
	focus(offset: number): void;
	/**
	 * `focus` WITHOUT the range-ending: seat the caret and touch nothing else. For
	 * selection-extend paths only (G2.12 guards the callers), where a `focus` would
	 * cancel the range still being grown; any other caller wants `focus`. Both doors are
	 * pinned by `e2e/tests/selection/public-caret-doors.spec.ts`.
	 */
	parkCaret?(offset: number): void;
	/**
	 * Caret position as a raw offset into this block's own bytes: ambient markers
	 * excluded, a widget counted as the source bytes it stands for. `null` (never 0)
	 * means not in this block — dispatch walks refs to find the focused one.
	 */
	getCursorOffset(): number | null;
	/**
	 * The current selection's rendered text, or `''` when unmounted or nothing is
	 * selected. NOT clipped to this block: a cross-block selection returns the whole
	 * range. Rendered, not raw — a caller needing this block's bytes slices `raw`.
	 */
	getSelectedText?(): string;
	/**
	 * Select `[start, end)` in the same raw-offset space `getCursorOffset` returns.
	 * A no-op when the block is unmounted or the range doesn't resolve.
	 */
	setSelection?(start: number, end: number): void;
	/**
	 * Position the cursor at the offset nearest editor-relative pixel X on the first
	 * (`'above'`) or last (`'below'`) visual line; callers fall back to focus(0) /
	 * CURSOR_END when a block omits it. Inherits {@link parkCaret}'s semantics — it does
	 * NOT end a live cross-block range, which vertical traversal can never reach.
	 */
	focusAtColumn?(x: number, from: StickyColumnDirection): void;
	/** Cascade focus down a path of child indices to reach a leaf at the given offset. */
	focusByPath?(path: number[], offset: number): void;
	/**
	 * Apply this surface's own click-intent caret snap for a viewport point inside its box,
	 * after a landing has been placed. A caret that fell at an atomic widget's edge has no
	 * visual representation there, so the prose surface moves it onto the edge and paints the
	 * indicator Chromium omits; one that landed in real text is left alone. Omitted by
	 * surfaces with no such snap.
	 */
	snapCaretToPoint?(clientX: number, clientY: number): void;
	/**
	 * Descend child indices to the BlockComponent at the leaf, or null if the path
	 * doesn't resolve. Empty `path` returns this component. Containers implement it.
	 */
	getBlockComponentByPath?(path: number[]): BlockComponent | null;
	/**
	 * Async sibling of getBlockComponentByPath: at each nested level, scroll the child
	 * into its window and await its mount before recursing, so an off-window target
	 * resolves instead of returning null.
	 */
	revealByPath?(path: number[]): Promise<BlockComponent | null>;
	/**
	 * Deep cursor position for nested-block surfaces (table cells): the path from this
	 * block to the leaf holding the cursor, plus the within-leaf offset. Preferred over
	 * getCursorOffset by getSelection() when implemented.
	 */
	getCursorPosition?(): { path: number[]; offset: number } | null;
	/**
	 * Viewport-space rects covering [startOffset, endOffset) in this block's visible
	 * text, for cross-block selection painting. Accepts SELECTION_END as endOffset,
	 * which surfaces interpret per their own coordinate system.
	 */
	measurePartialRects?(startOffset: number, endOffset: number): DOMRect[];
	/**
	 * Viewport-space rect of a single cell by 2D coordinate — whole-cell highlighting on
	 * grid surfaces, bypassing measurePartialRects' selection-aware range logic. Null
	 * when the cell isn't mounted or the coordinate is out of range.
	 */
	cellRect?(rowIdx: number, colIdx: number): DOMRect | null;
	/**
	 * Current mounted row-window `[start, end)` of a row-windowed grid surface. Overlays
	 * read it reactively so a repaint fires once the re-sliced rows are committed —
	 * off-window rows can't paint until mounted.
	 */
	mountedRowWindow?(): { start: number; end: number };
	/**
	 * True when vertical traversal should pass straight through: no caret-able text
	 * positions of its own, only widgets carrying no column meaning. Decided from the
	 * CST, not mounted refs, so a container answers the same for an off-window child.
	 */
	isVerticallyTransparent?(): boolean;
	/**
	 * Enter an edge widget instead of placing a caret at its boundary. What "enter" means
	 * belongs to the kind's registered `InlineWidgetEditingPolicy` — an open vocabulary,
	 * not a two-way choice. False lets the caller fall through to focus(0) / CURSOR_END.
	 */
	enterEdgeWidget?(side: 'start' | 'end'): boolean;
	/**
	 * Run a named block-local command resolved from a keybinding. `arg` carries the
	 * binding's static argument as `unknown` — the handler must type-guard it and ignore
	 * an out-of-shape value. False lets the caller fall through to later keydown branches.
	 */
	runCommand?(id: import('./schema/command-id').AnyCommandId, arg?: unknown): boolean;
	/**
	 * Current raw-offset selection in an editable leaf, a collapsed caret as
	 * `{start: n, end: n}`. Captured before a right-click menu steals focus.
	 */
	getSelectionOffsets?(): { start: number; end: number } | null;
	/**
	 * Claim a copy/cut/paste the editor root received because a selection state this block
	 * owns seats no native caret: a selected inline widget in a block with no text position
	 * leaves the native selection empty, so the browser dispatches at `<body>`. The claim is
	 * unconditional once the root has targeted this block, so there is nothing to report back:
	 * the seam offers the event to one arm only, and never re-offers it elsewhere.
	 */
	claimRootClipboard?(event: ClipboardEvent): void;
	/**
	 * Run a clipboard action from the table cell's right-click menu against the offsets
	 * captured at menu-open (focus/selection may have moved since).
	 */
	applyMenuClipboard?(
		action: 'cut' | 'copy' | 'paste',
		sel: { start: number; end: number }
	): Promise<void>;
	/**
	 * Whether this component's own surface takes text input. NOT the flag the editor
	 * gates on: merge eligibility and search read the *descriptor*'s `editable` for the
	 * kind. Keep the two in agreement.
	 */
	readonly editable: boolean;
	/** Whether focus may land on this block at all. This is the flag focus dispatch reads. */
	readonly focusable: boolean;
}

// ── Published instance surface ─────────────────────────────────────────────

/**
 * Every member a container owes, promoted to required: a caret entering a container has
 * to descend, so the descent verbs are not "implement if you can" the way a leaf's
 * optionals are. `createContainerBlockComponent` returns this.
 */
export type ContainerBlockComponent = BlockComponent &
	Required<
		Pick<
			BlockComponent,
			| 'getCursorPosition'
			| 'focusByPath'
			| 'getBlockComponentByPath'
			| 'revealByPath'
			| 'focusAtColumn'
			| 'isVerticallyTransparent'
			| 'enterEdgeWidget'
			| 'parkCaret'
		>
	>;

/**
 * What a mounted block component publishes through `bind:this`: a leaf publishes the
 * surface itself, a container publishes it under the one `containerApi` export (Svelte 5
 * instance exports are individual declarations with no spread, so re-exporting a dozen
 * members by hand drops one). The union is the enforcement — a container publishing a
 * leaf-grade surface is a type error at its `defineBlockComponent` registration site.
 */
export type BlockComponentExports =
	BlockComponent | { readonly containerApi: ContainerBlockComponent };

/**
 * The `BlockComponent` behind a published instance — the one point that knows a
 * container's surface hides under `containerApi`. Returns the object it was handed,
 * never a wrapper: `publishRefSlot` compares identity, so a fresh one stomps a slot.
 */
export function resolveBlockSurface(
	exports: BlockComponentExports | undefined
): BlockComponent | undefined {
	if (!exports) return undefined;
	return 'containerApi' in exports ? exports.containerApi : exports;
}
