/**
 * Viewport-space geometry over the rendered document, the public face of the measurement calls
 * block components expose. Offsets mean what `measurePartialRects` means for that block (raw
 * offsets on prose, cell coordinates in a grid). jsdom reports boxes of about zero size, so e2e
 * covers this file rather than unit tests.
 */
import { tick } from 'svelte';
import type { BlockComponent } from './block-component';
import type { RevealAnchorState, RevealClaim } from './cursor/reveal-anchor';

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
	 *  true, keeps it in place against later layout shifts. True once it stops moving. */
	scrollTo(
		path: readonly number[],
		opts?: { block?: 'nearest' | 'center'; hold?: boolean }
	): Promise<boolean>;
	/** Mount `path`, scroll to it and put the caret at `offset` (default 0) through undo's restore
	 *  path, so the next keystroke addresses the document. True once the caret lands in view. */
	navigateTo(path: readonly number[], offset?: number): Promise<boolean>;
}

// The measure passes after a mount finish within a few Svelte flushes; `tick` is the only
// sequencing tool in this repo, so the wait is a fixed number of them.
const REVEAL_SETTLE_TICKS = 12;

/** The one place `scrollTo` and the caret landing write a scroll position, in two steps around
 *  the mount: `place` takes the viewport before the first await, `scroll` runs once it's mounted. */
export interface ScrollSettle {
	/** Whether the mounted block at `path` is visible in the editor's viewport. */
	isInView(path: readonly number[]): boolean;
	place(path: readonly number[], opts: PlaceOptions): ScrollPlacement;
}

export interface PlaceOptions {
	block: 'nearest' | 'center';
	/** Keep the block where it landed against later layout shifts, until a user scroll or a newer
	 *  placement. */
	hold: boolean;
}

export interface ScrollPlacement {
	/** Scroll the mounted block into view and follow it until it stops moving; true when it ends
	 *  in view. A newer placement stops it at once. */
	scroll(): Promise<boolean>;
}

export function createScrollSettle(deps: {
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	getEditorRoot: () => HTMLElement | null;
	/** True when an ancestor owns the scroll (`scrollMode="host"`): the root then spans the whole
	 *  document, so intersecting a block with it says nothing about visibility. */
	isHostScroll: () => boolean;
	/** In host mode, the ancestors that bound what can be seen: intersected with the window viewport,
	 *  never used instead of it, or a bound that clips nothing reports every block visible. */
	getClipBounds: () => HTMLElement[];
	revealAnchor: RevealAnchorState;
}): ScrollSettle {
	function elementInView(el: HTMLElement, root: HTMLElement): boolean {
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

	// `correctAnchor` estimates from the height table before the flush, so each tick refines after
	// it until the target stops moving.
	async function followIntoView(
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
			// Done: the placement held still since the previous tick.
			const afterAnchor = el.getBoundingClientRect().top;
			if (afterAnchor === placedTop) break;
			el.scrollIntoView({ block });
			placedTop = el.getBoundingClientRect().top;
		}
		const el = deps.getBlockElByPath(path);
		return el != null && elementInView(el, root);
	}

	return {
		isInView(path) {
			const root = deps.getEditorRoot();
			const el = deps.getBlockElByPath([...path]);
			return !!root && !!el && elementInView(el, root);
		},
		place(path, { block, hold }) {
			const p = [...path];
			const claim = deps.revealAnchor.claim(p, block);
			return {
				async scroll() {
					// Checked first: a claim another scroll took over during a long mount wait would
					// otherwise yank the viewport once, before the first tick could stop it.
					if (!claim.isSuperseded()) deps.getBlockElByPath(p)?.scrollIntoView({ block });
					const landed = await followIntoView(p, block, claim);
					// Released on 'center' or a failed scroll too: the approximate hold would drift a
					// target placed exactly, while holding the top approximately is 'nearest''s promise.
					if (!hold || block === 'center' || !landed) claim.release();
					return landed;
				}
			};
		}
	};
}

export function createEditorRects(deps: {
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	getBlockComponent: (path: number[]) => BlockComponent | null;
	/** Mounts `path`, opening a collapsed body on the way: every caller here is a navigation. */
	revealPath: (path: number[]) => Promise<unknown>;
	getEditorRoot: () => HTMLElement | null;
	scroll: ScrollSettle;
	isCrossBlock: () => boolean;
	/** True for nodes in the host's `header` snippet: inside the root, but not this
	 *  editor's content. */
	isHostChrome: (node: Node | null) => boolean;
	/** Put a caret at a raw offset in `path` through the shared restore path. Injected
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
			// scroll (a match click's pointerdown releases, then this claims again).
			const placement = deps.scroll.place(p, { block, hold: opts?.hold !== false });
			await deps.revealPath(p);
			return placement.scroll();
		},
		navigateTo(path, offset = 0) {
			return deps.landCaretAt([...path], offset);
		}
	};
}
