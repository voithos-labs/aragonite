/**
 * Viewport-space geometry over the rendered document. The public face of the
 * measurement primitives block components already expose: a block's box, the
 * rects covering an inline range, the native caret, and a reveal that mounts a
 * windowed-out block. Coordinates are viewport-space `DOMRect`s; offsets inherit
 * `measurePartialRects`' per-surface meaning (raw offsets on prose leaves,
 * cell-index coordinates on grid surfaces).
 *
 * Rects are real only in a browser — jsdom reports ~0-sized boxes — so this
 * surface is exercised through the e2e suite, not unit tests.
 */
import type { BlockComponent } from './block-component';

export interface EditorRects {
	/** The block's outermost box, or null when it isn't mounted. */
	blockRect(path: number[]): DOMRect | null;
	/**
	 * Rects covering `[start, end)` in the block's measurable content — one per
	 * visual line on a wrapped prose leaf, one per cell on a grid surface.
	 * `SELECTION_END` is accepted as `end` to mean "through the block's last
	 * measurable position". Empty when the block isn't mounted or can't measure.
	 */
	rangeRects(path: number[], start: number, end: number): DOMRect[];
	/**
	 * The live native single-block caret, or null. Null in cross-block mode: the
	 * suppressed native selection parks a range that is not a caret and must not
	 * leak out as one.
	 */
	caretRect(): DOMRect | null;
	/** Scroll a windowed-out block into its window and await its mount. Resolves
	 *  true once the block's element is present. */
	reveal(path: number[]): Promise<boolean>;
}

export function createEditorRects(deps: {
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	getBlockComponentByPath: (path: number[]) => BlockComponent | null;
	revealPath: (path: number[]) => Promise<unknown>;
	getEditorRoot: () => HTMLElement | null;
	isCrossBlock: () => boolean;
}): EditorRects {
	return {
		blockRect(path) {
			return deps.getBlockElByPath(path)?.getBoundingClientRect() ?? null;
		},
		rangeRects(path, start, end) {
			return deps.getBlockComponentByPath(path)?.measurePartialRects?.(start, end) ?? [];
		},
		caretRect() {
			// Read SelectionState, not the `data-cross-block` DOM mirror: that attribute
			// is written by a deferred $effect and lags the synchronous selectionChange
			// emit, so a subscriber calling caretRect() mid-emit would read a stale
			// attribute and leak the parked cross-block range as a caret. In cross-block
			// mode the native selection is a parked range, not a caret — suppress it.
			if (deps.isCrossBlock()) return null;
			const root = deps.getEditorRoot();
			if (!root) return null;
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			if (!root.contains(range.commonAncestorContainer)) return null;
			return range.getBoundingClientRect();
		},
		async reveal(path) {
			await deps.revealPath(path);
			return deps.getBlockElByPath(path) != null;
		}
	};
}
