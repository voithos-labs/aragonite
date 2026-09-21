/**
 * Viewport-space geometry over the rendered document, the public face of the measurement
 * calls block components expose. Offsets mean whatever `measurePartialRects` means for that
 * block (raw offsets on prose leaves, cell-index coordinates in a grid). Rects are real only
 * in a browser, since jsdom reports boxes of about zero size, so e2e covers this file rather
 * than unit tests.
 */
import { tick } from 'svelte';
import type { BlockComponent } from './block-component';
import type { RevealAnchorState, RevealClaim } from './cursor/reveal-anchor';

export interface EditorRects {
	/** The block's outermost box, or null when it isn't mounted. */
	blockRect(path: number[]): DOMRect | null;
	/**
	 * Rects covering `[start, end)` in the block's measurable content: one per visual line
	 * on a wrapped prose leaf, one per cell in a grid. `SELECTION_END` is accepted as `end`.
	 * Empty when the block isn't mounted or can't measure.
	 */
	rangeRects(path: number[], start: number, end: number): DOMRect[];
	/**
	 * The browser's caret when it sits in one block, or null. Null in cross-block mode too,
	 * where the held range is not a caret and must not leak out as one.
	 */
	caretRect(): DOMRect | null;
	/** Scroll a block that is not rendered yet into the mounted range and await its mount.
	 *  Resolves true once the block's element is present. */
	reveal(path: number[]): Promise<boolean>;
	/**
	 * Mount the block at `path`, then scroll the viewport to it. `block` defaults to
	 * `'nearest'`; `hold` (default true) keeps holding that block in place afterwards, so a
	 * later layout shift cannot push it back out. Resolves true only once the position stops
	 * moving; if a later scroll takes over, this one stops refining and reports what is visible.
	 */
	scrollTo(
		path: readonly number[],
		opts?: { block?: 'nearest' | 'center'; hold?: boolean }
	): Promise<boolean>;
	/**
	 * Go to `path`: mount it, scroll to it, and put the caret at `offset` (default 0), so the
	 * next keystroke, Ctrl+Z included, addresses the document rather than the control that was
	 * clicked. Runs the same restore path undo and `setSelection` use. True means the caret
	 * landed and the target came to rest in view.
	 */
	navigateTo(path: readonly number[], offset?: number): Promise<boolean>;
}

// The measure passes after a mount finish within a few Svelte flushes; `tick` is the only
// sequencing tool in this repo, so the wait is a fixed number of them.
const REVEAL_SETTLE_TICKS = 12;

export function createEditorRects(deps: {
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	getBlockComponentByPath: (path: number[]) => BlockComponent | null;
	revealPath: (path: number[]) => Promise<unknown>;
	getEditorRoot: () => HTMLElement | null;
	/** True when an ancestor owns the scroll (`scrollMode="host"`): the root is then not the
	 *  scroll container but spans the whole document, so intersecting a block with it answers
	 *  "is this in the document" rather than "is this visible". */
	isHostScroll: () => boolean;
	/** In host mode, the ancestors that bound what can be seen. Intersected with the window
	 *  viewport, never used instead of it: a bound that clips nothing would report every
	 *  block as visible. */
	getClipBounds: () => HTMLElement[];
	isCrossBlock: () => boolean;
	/** True for nodes in the host's `header` snippet: inside the root, but not this
	 *  editor's content. */
	isHostChrome: (node: Node | null) => boolean;
	revealAnchor: RevealAnchorState;
	/** Put a caret at a raw offset in `path` through the shared restore path. Injected
	 *  because this file owns geometry, not the selection model. */
	landCaretAt: (path: number[], offset: number) => Promise<boolean>;
}): EditorRects {
	function isInView(el: HTMLElement, root: HTMLElement): boolean {
		const br = el.getBoundingClientRect();
		// Self mode: the root is the scroll container, and what lies outside it is the host
		// page's business, not the editor's.
		if (!deps.isHostScroll()) {
			const er = root.getBoundingClientRect();
			return br.top < er.bottom && br.bottom > er.top;
		}
		if (br.top >= window.innerHeight || br.bottom <= 0) return false;
		for (const bound of deps.getClipBounds()) {
			const cr = bound.getBoundingClientRect();
			if (br.top >= cr.bottom || br.bottom <= cr.top) return false;
		}
		return true;
	}

	// `correctAnchor` works from the height table and runs before the flush, so it can be off
	// by a boundary block's height; each tick refines the placement after the flush, when DOM
	// reads are exact, and stops once the target stops moving. A claim another scroll has
	// taken over gives up at once (the viewport is that newer scroll's), but one that only
	// lost its hold to a user gesture keeps refining, since it is still on its way.
	async function settleInView(
		path: number[],
		block: 'nearest' | 'center',
		claim: RevealClaim
	): Promise<boolean> {
		const root = deps.getEditorRoot();
		if (!root) return deps.getBlockElByPath(path) != null;
		let placedTop: number | null = null;
		for (let i = 0; i < REVEAL_SETTLE_TICKS; i++) {
			await tick();
			if (claim.isSuperseded()) break;
			const el = deps.getBlockElByPath(path);
			if (!el) {
				placedTop = null; // briefly unmounted while the window re-slices; keep going
				continue;
			}
			// Done: the scroll correction no longer moves the placement from the previous tick.
			const afterAnchor = el.getBoundingClientRect().top;
			if (afterAnchor === placedTop) break;
			el.scrollIntoView({ block });
			placedTop = el.getBoundingClientRect().top;
		}
		const el = deps.getBlockElByPath(path);
		return el != null && isInView(el, root);
	}

	return {
		blockRect(path) {
			return deps.getBlockElByPath(path)?.getBoundingClientRect() ?? null;
		},
		rangeRects(path, start, end) {
			return deps.getBlockComponentByPath(path)?.measurePartialRects?.(start, end) ?? [];
		},
		caretRect() {
			// Read `SelectionState`, not the `data-cross-block` attribute: that attribute is
			// written by a deferred `$effect` and lags the synchronous `selectionChange` emit,
			// so a subscriber reading during the emit would get the held range as a caret.
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
			// Claim before the first await so the hold survives the gesture that started this
			// scroll (a match click's pointerdown releases, then this claims again).
			const claim = deps.revealAnchor.claim(p, block);
			await deps.revealPath(p);
			// Checked first: a claim another scroll took over during a long mount wait would
			// otherwise yank the viewport once, before the first tick could stop it.
			if (!claim.isSuperseded()) deps.getBlockElByPath(p)?.scrollIntoView({ block });
			const landed = await settleInView(p, block, claim);
			// Release on 'center': the hold is only approximate, and its later corrections would
			// drift a target this loop already placed exactly. 'nearest' holds by default,
			// because holding the top approximately is what it promises. A failed scroll holds
			// nothing.
			if (block === 'center' || !landed || opts?.hold === false) claim.release();
			return landed;
		},
		navigateTo(path, offset = 0) {
			return deps.landCaretAt([...path], offset);
		}
	};
}
