/**
 * Viewport-space geometry over the rendered document, the public face of the measurement calls
 * block components expose. Offsets mean what `measurePartialRects` means for that block (raw
 * offsets on prose, cell coordinates in a grid). jsdom reports boxes of about zero size, so e2e
 * covers this file rather than unit tests.
 */
import type { BlockComponent } from './block-component';
import type { ScrollOwner } from './cursor/scroll-owner';

export interface EditorRects {
	/** The block's outermost box, or null when it isn't mounted. */
	blockRect(path: number[]): DOMRect | null;
	/** Rects covering `[start, end)` of the block's measurable content: one per visual line of prose,
	 *  one per grid cell. `end` accepts `SELECTION_END`; empty when the block isn't mounted. */
	rangeRects(path: number[], start: number, end: number): DOMRect[];
	/**
	 * The browser's caret when it sits in one block, or null. Null in cross-block mode too,
	 * where the held range is not a caret and must not leak out as one.
	 */
	caretRect(): DOMRect | null;
	/** Scroll a block that is not rendered yet into the mounted range and await its mount.
	 *  Resolves true once the block's element is present. */
	reveal(path: number[]): Promise<boolean>;
	/** Mount the block at `path` and scroll to it (`block` defaults to `'nearest'`); `hold`, default
	 *  true, keeps it where it landed against later layout shifts. True once in view and settled. */
	scrollTo(
		path: readonly number[],
		opts?: { block?: 'nearest' | 'center'; hold?: boolean }
	): Promise<boolean>;
	/** Mount `path`, scroll there and land the caret at `offset` (default 0) as an edit does, so the
	 *  next key addresses the document; a closed `<details>` on the way opens. True once in view. */
	navigateTo(path: readonly number[], offset?: number): Promise<boolean>;
}

export function createEditorRects(deps: {
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	getBlockComponent: (path: number[]) => BlockComponent | null;
	/** Mounts `path`, opening a collapsed body on the way: every caller here is a navigation. */
	revealPath: (path: number[]) => Promise<unknown>;
	getEditorRoot: () => HTMLElement | null;
	scroll: Pick<ScrollOwner, 'place'>;
	isCrossBlock: () => boolean;
	/** True for nodes in the host's `header` snippet: inside the root, but not this
	 *  editor's content. */
	isHostChrome: (node: Node | null) => boolean;
	/** Put a caret at a raw offset in `path` through the caret landing, as a navigation. Injected
	 *  because this file owns geometry, not the selection model. */
	landCaretAt: (path: number[], offset: number) => Promise<boolean>;
}): EditorRects {
	return {
		blockRect(path) {
			return deps.getBlockElByPath(path)?.getBoundingClientRect() ?? null;
		},
		rangeRects(path, start, end) {
			return deps.getBlockComponent(path)?.measurePartialRects?.(start, end) ?? [];
		},
		caretRect() {
			// Read `SelectionState`, not the `data-cross-block` attribute: a deferred `$effect`
			// writes the attribute, so it lags the synchronous `selectionChange` emit.
			if (deps.isCrossBlock()) return null;
			const root = deps.getEditorRoot();
			if (!root) return null;
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			if (!root.contains(range.commonAncestorContainer)) return null;
			// A caret in the host's header snippet is inside the root but is not a document
			// caret; reporting it would float caret-following controls over the host's field.
			if (deps.isHostChrome(range.commonAncestorContainer)) return null;
			return range.getBoundingClientRect();
		},
		async reveal(path) {
			await deps.revealPath(path);
			return deps.getBlockElByPath(path) != null;
		},
		async scrollTo(path, opts) {
			const p = [...path];
			const block = opts?.block ?? 'nearest';
			// Placed before the first await so the hold survives the gesture that started this
			// scroll (a match click's pointerdown releases, then this places again).
			const placement = deps.scroll.place(p, { block, hold: opts?.hold !== false });
			await deps.revealPath(p);
			return placement.scroll();
		},
		navigateTo(path, offset = 0) {
			return deps.landCaretAt([...path], offset);
		}
	};
}
