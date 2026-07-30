/**
 * The view-layer contract every rendered block satisfies, plus the cursor
 * sentinels and ambient-prefix shape block components produce and consume.
 * Orchestration reaches a block only through this interface, so a capability a
 * block lacks is an omitted optional member rather than a kind check upstream.
 * This file is authoritative for external authors: each member's docstring
 * states its contract (docs/design/editor.md § The block interface).
 */

import type { DocumentView, NodeView } from './core/node-views';
import type { EditorRects } from './editor-rects';

// ── Sentinels ──────────────────────────────────────────────────────────────

declare const cursorEndBrand: unique symbol;
/** Branded `number`: a focus offset meaning "end of content", not a position. */
export type CursorEnd = number & { readonly [cursorEndBrand]: true };

declare const selectionEndBrand: unique symbol;
/** Branded `number`: a measurePartialRects endOffset meaning "end of range". */
export type SelectionEnd = number & { readonly [selectionEndBrand]: true };

/**
 * "Place cursor at end of content." The focus walkers fall through to their
 * end-of-content fallback whenever the requested offset exceeds the block's
 * length, so MAX_SAFE_INTEGER lands at the end of any block. A finite value
 * (the former 999999) instead landed mid-block once content was longer.
 */
export const CURSOR_END = Number.MAX_SAFE_INTEGER as CursorEnd;

/** Cascade focus to the last descendant and place the cursor at its start. */
export const FOCUS_LAST_START = -1;

/**
 * "End of this block's measurable range" for measurePartialRects' endOffset.
 * Each surface interprets it in its own coordinate system; MAX_SAFE_INTEGER
 * lets text surfaces fall through to native range clamping without special-
 * casing, and TableBlock matches it explicitly to select through the last cell.
 */
export const SELECTION_END = Number.MAX_SAFE_INTEGER as SelectionEnd;

// ── Helper types ───────────────────────────────────────────────────────────

/**
 * Direction the cursor is entering a block from for sticky-column moves.
 * `'above'` = downward move; `'below'` = upward move.
 */
export type StickyColumnDirection = 'above' | 'below';

/**
 * Focus position for moveFocus. The sticky-column variant aligns the cursor
 * to the current sticky X on the target's first or last visual line, falling
 * back to focus(0) / focus(CURSOR_END) when focusAtColumn is unimplemented.
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
 * The props BlockHost passes every block component: the node, its sibling index,
 * the absolute path, and the ambient prefix a leaf renders before its content (a
 * list marker, a blockquote bar). A registry `extraProps` may add kind-specific
 * props on top. A component may declare a subset — Svelte ignores props it omits,
 * but a leaf that drops `ambientPrefix` visually deletes its markers.
 */
export interface BlockComponentProps {
	/** Bytes-readonly view (G1.9): components render the CST; mutation routes through actions. */
	node: NodeView;
	index: number;
	myPath: number[];
	ambientPrefix: AmbientPrefix;
	/** The root document, readonly by type — mutation stays a commit-ceremony concern. */
	document?: DocumentView;
	/** The owning instance's rect surface: measure/reveal/scroll by path. The live
	 *  instance object (delivered through editor context), so a block navigating to
	 *  another block shares the editor's one seam. */
	rects?: EditorRects;
}

// ── BlockComponent ─────────────────────────────────────────────────────────

export interface BlockComponent {
	/**
	 * Place the caret at `offset`, focusing the surface, and end any live
	 * cross-block range so the new caret owns the selection. Two sentinels arrive
	 * through this same `number`: `CURSOR_END` (past any length, meaning end of
	 * content) and `FOCUS_LAST_START` (`-1`, which a leaf clamps to 0 and a
	 * container cascades into its last child). An out-of-range offset must clamp,
	 * never throw. A raw DOM seek on `-1` raises IndexSizeError and loses the caret.
	 *
	 * The safe default, and the door to reach for: a caret that lands inside a
	 * range left live is a document the next keystroke type-replaces. Implement it
	 * by minting `selection/caret-doors.ts`' `placeCaret` over {@link parkCaret},
	 * never by hand — the range-ending has to be batched with the landing or a
	 * `selectionChange` subscriber reads back the outgoing caret.
	 */
	focus(offset: number): void;
	/**
	 * `focus` WITHOUT the range-ending: seat the caret and touch nothing else.
	 *
	 * For selection-extend paths only. The cross-block dispatcher parks a caret in
	 * an endpoint it has just revealed so the next keystroke stays routed, while the
	 * extend is still growing the range that a `focus` would cancel. Any other
	 * caller wants `focus`. Omitting it costs an extend nothing but the parked
	 * caret: focus falls to the editor root, whose document-level listener routes
	 * the next cross-block keystroke anyway. Both doors are pinned by
	 * `e2e/tests/selection/public-caret-doors.spec.ts`; G2.12 guards the callers.
	 */
	parkCaret?(offset: number): void;
	/**
	 * Caret position as a raw offset into this block's own bytes: ambient markers
	 * excluded, a widget counted as the source bytes it stands for. `null` means
	 * the caret is not in this block, which is how dispatch walks refs to find the
	 * focused one, so returning 0 for "not focused" breaks that walk.
	 */
	getCursorOffset(): number | null;
	/**
	 * The current selection's rendered text, or `''` when the block is unmounted
	 * or nothing is selected. Read from the platform selection and NOT clipped to
	 * this block, so during a cross-block selection it returns the whole range.
	 * Rendered, not raw: a widget contributes what it draws (a decoded glyph, or
	 * nothing), so a caller that needs this block's bytes slices `raw` instead.
	 */
	getSelectedText?(): string;
	/**
	 * Select `[start, end)` in the same raw-offset space `getCursorOffset` returns.
	 * A no-op when the block is unmounted or the range doesn't resolve.
	 */
	setSelection?(start: number, end: number): void;
	/**
	 * Position the cursor at the offset nearest to editor-relative pixel X
	 * on the first (`'above'`) or last (`'below'`) visual line. Non-
	 * participating blocks omit this; callers fall back to focus(0) / CURSOR_END.
	 *
	 * Range semantics differ from {@link focus} and are deliberately narrower: this
	 * inherits {@link parkCaret}'s behavior and does NOT end a live cross-block range.
	 * It is a column landing for vertical traversal, which the cross-block dispatcher
	 * cannot reach — a plain ArrowUp/Down with a range live is consumed by the collapse
	 * before sticky-column dispatch runs. A caller placing a caret because the USER
	 * acted wants `focus`. If a range-live caller ever appears, this routes through the
	 * same `placeCaret` door additively: the range-ending is behavior, not shape.
	 */
	focusAtColumn?(x: number, from: StickyColumnDirection): void;
	/** Cascade focus down a path of child indices to reach a leaf at the given offset. */
	focusByPath?(path: number[], offset: number): void;
	/**
	 * Descend a path of child indices and return the BlockComponent at the
	 * leaf, or null if the path doesn't resolve. Empty `path` returns the
	 * current component. Container blocks implement it; leaf blocks rely on
	 * the default behavior (the path must be empty to match).
	 */
	getBlockComponentByPath?(path: number[]): BlockComponent | null;
	/**
	 * Async sibling of getBlockComponentByPath: at each nested level, scroll the
	 * child into its window and await its mount before recursing, so an off-window
	 * target resolves instead of returning null. Adjacent (already-mounted) targets
	 * resolve via the fast path with no scroll.
	 */
	revealByPath?(path: number[]): Promise<BlockComponent | null>;
	/**
	 * Deep cursor position for nested-block surfaces (e.g., table cells).
	 * Returns the path from this block to the leaf containing the cursor,
	 * plus the within-leaf offset. When implemented, Editor.svelte's
	 * getSelection() prefers this over getCursorOffset.
	 */
	getCursorPosition?(): { path: number[]; offset: number } | null;
	/**
	 * Viewport-space rects covering [startOffset, endOffset) in this block's
	 * visible text, for cross-block selection painting. Accepts SELECTION_END
	 * as endOffset to mean "from startOffset through the last measurable
	 * position in this block"; surfaces interpret per their coordinate
	 * system (see the SELECTION_END docstring).
	 */
	measurePartialRects?(startOffset: number, endOffset: number): DOMRect[];
	/**
	 * Viewport-space rect of a single cell, addressed by 2D coordinate. For
	 * whole-cell highlighting (search matches) on grid surfaces, where the
	 * caller has a `[rowIdx, colIdx]` and wants that cell's box directly,
	 * bypassing measurePartialRects' selection-aware range logic. Returns null
	 * when the cell isn't mounted or the coordinate is out of range.
	 */
	cellRect?(rowIdx: number, colIdx: number): DOMRect | null;
	/**
	 * Current mounted row-window `[start, end)` of a row-windowed grid surface
	 * (table). Overlays read it reactively so a repaint fires after the window
	 * re-slices and the new rows are committed (off-window rows can't paint until
	 * mounted). Absent on non-windowed-grid blocks.
	 */
	mountedRowWindow?(): { start: number; end: number };
	/**
	 * True when vertical traversal (ArrowUp/Down sticky-column dispatch)
	 * should pass straight through this block — the block has no caret-able
	 * text positions of its own, only widgets that carry no column meaning.
	 * Decided from the CST rather than from mounted refs, so a container answers
	 * the same for an off-window child: it is transparent when every child is.
	 */
	isVerticallyTransparent?(): boolean;
	/**
	 * Enter an edge widget instead of placing a caret at its boundary. What
	 * "enter" means belongs to the widget kind's registered
	 * `InlineWidgetEditingPolicy` (`revealSource`, `onEdge`), which is an open
	 * vocabulary, not a two-way reveal-or-select choice. Read that type before
	 * implementing an else-branch. Returns true when an edge widget was entered;
	 * false lets the caller fall through to focus(0) / focus(CURSOR_END).
	 */
	enterEdgeWidget?(side: 'start' | 'end'): boolean;
	/**
	 * Run a named block-local command (split, indent, format, …) resolved from
	 * a keybinding. `arg` carries the binding's static argument (e.g. heading
	 * level) as `unknown`: the handler must type-guard it before use and ignore
	 * an out-of-shape value. Returns true when the command acted; false lets the
	 * caller fall through to remaining inline keydown branches. Block components
	 * that declare a keymap implement this; others omit it.
	 */
	runCommand?(id: import('./schema/command-id').AnyCommandId, arg?: unknown): boolean;
	/**
	 * Current raw-offset selection in an editable leaf (table cell), collapsed
	 * caret returned as `{start: n, end: n}`. Captured before a right-click menu
	 * steals focus so a later clipboard action can restore the exact range.
	 */
	getSelectionOffsets?(): { start: number; end: number } | null;
	/**
	 * Run a clipboard action from the table cell's right-click menu against the
	 * offsets captured at menu-open (focus/selection may have moved since).
	 */
	applyMenuClipboard?(
		action: 'cut' | 'copy' | 'paste',
		sel: { start: number; end: number }
	): Promise<void>;
	/**
	 * Whether this component's own surface takes text input. NOT the flag the
	 * editor gates on: merge eligibility and search read the *descriptor*'s
	 * `editable` for the kind. Keep the two in agreement.
	 */
	readonly editable: boolean;
	/** Whether focus may land on this block at all. This is the flag focus dispatch reads. */
	readonly focusable: boolean;
}

// ── Published instance surface ─────────────────────────────────────────────

/**
 * The surface with every member a container owes promoted to required. A caret
 * entering a container has to descend, so the descent verbs are not "implement if
 * you can" the way a leaf's optionals are. `createContainerBlockComponent` returns
 * this; a hand-rolled container annotates its own export with it.
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
 * What a mounted block component publishes through `bind:this`. A leaf publishes
 * the surface itself. A container publishes it under ONE well-known export:
 * Svelte 5 instance exports are individual top-level declarations with no spread,
 * and re-exporting a dozen members by hand let four blocks silently drop one.
 *
 * The union is the enforcement, and the container arm is `ContainerBlockComponent`
 * rather than `BlockComponent` so it carries the completeness the retired
 * per-member `satisfies` guard used to: a container publishing a leaf-grade
 * `containerApi` is a `defineBlockComponent` type error at its registration site,
 * exactly as one publishing nothing is.
 */
export type BlockComponentExports =
	| BlockComponent
	| { readonly containerApi: ContainerBlockComponent };

/**
 * The `BlockComponent` behind a published instance — the one point that knows a
 * container's surface hides under `containerApi`.
 *
 * Returns the object it was handed, never a wrapper: `publishRefSlot` clears a ref
 * slot only while it still holds the ref it wrote, so a fresh identity per read
 * would stomp a neighbour's slot.
 */
export function resolveBlockSurface(
	exports: BlockComponentExports | undefined
): BlockComponent | undefined {
	if (!exports) return undefined;
	return 'containerApi' in exports ? exports.containerApi : exports;
}
