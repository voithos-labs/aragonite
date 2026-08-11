/**
 * Viewport-space geometry over the rendered document, the public face of the measurement
 * primitives block components expose. Offsets inherit `measurePartialRects`' per-surface
 * meaning (raw offsets on prose leaves, cell-index coordinates on grid surfaces). Rects
 * are real only in a browser — jsdom reports ~0-sized boxes — so e2e covers this surface,
 * not unit tests.
 */
import { tick } from 'svelte';
import type { BlockComponent } from './block-component';
import type { RevealAnchorState, RevealClaim } from './cursor/reveal-anchor';

export interface EditorRects {
	/** The block's outermost box, or null when it isn't mounted. */
	blockRect(path: number[]): DOMRect | null;
	/**
	 * Rects covering `[start, end)` in the block's measurable content — one per visual
	 * line on a wrapped prose leaf, one per cell on a grid surface. `SELECTION_END` is
	 * accepted as `end`. Empty when the block isn't mounted or can't measure.
	 */
	rangeRects(path: number[], start: number, end: number): DOMRect[];
	/**
	 * The live native single-block caret, or null — including in cross-block mode, whose
	 * parked range is not a caret and must not leak out as one.
	 */
	caretRect(): DOMRect | null;
	/** Scroll a windowed-out block into its window and await its mount. Resolves
	 *  true once the block's element is present. */
	reveal(path: number[]): Promise<boolean>;
	/**
	 * Reveal (mount) the block at `path`, then scroll the viewport to it. `block` defaults to
	 * `'nearest'`; `hold` (default true) keeps the reveal's pin afterward, so a later layout
	 * shift cannot push the target back out. Resolves true only once the position settles; a
	 * reveal superseded by a later one stops refining and reports honest visibility. The pin is
	 * inert in host-scroll mode, where windowing never activates.
	 */
	scrollTo(
		path: readonly number[],
		opts?: { block?: 'nearest' | 'center'; hold?: boolean }
	): Promise<boolean>;
	/**
	 * Navigate to `path`: reveal, scroll, and land the caret at the block's start, so the
	 * next keystroke (Ctrl+Z included) addresses the document rather than the affordance
	 * that was clicked. Runs the same restore road undo and `setSelection` use. True means
	 * the caret landed AND the target settled into view.
	 */
	navigateTo(path: readonly number[]): Promise<boolean>;
}

// Post-mount measure passes settle within a few Svelte flushes; `tick` is the repo's only
// sequencing primitive, so the wait is a bounded count of them.
const REVEAL_SETTLE_TICKS = 12;

export function createEditorRects(deps: {
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	getBlockComponentByPath: (path: number[]) => BlockComponent | null;
	revealPath: (path: number[]) => Promise<unknown>;
	getEditorRoot: () => HTMLElement | null;
	/** True when an ancestor owns the scroll (`scrollMode="host"`): the root is then no
	 *  scrollport but spans the WHOLE document, so intersecting a block with it answers
	 *  "is this in the document" rather than "is this visible". */
	isHostScroll: () => boolean;
	/** Host mode's ancestors that bound what can be seen. Intersected WITH the window
	 *  viewport, never instead of it: a bound that clips nothing would swallow the fold. */
	getClipBounds: () => HTMLElement[];
	isCrossBlock: () => boolean;
	/** True for nodes in the host's `header` slot — inside the root, but not this
	 *  editor's content. */
	isHostChrome: (node: Node | null) => boolean;
	revealAnchor: RevealAnchorState;
	/** Land a caret at the start of `path` through the shared restore road. Injected
	 *  because this surface owns geometry, not the selection model. */
	landCaretAt: (path: number[]) => Promise<boolean>;
}): EditorRects {
	function isInView(el: HTMLElement, root: HTMLElement): boolean {
		const br = el.getBoundingClientRect();
		// Self mode: the root IS the scrollport, and what lies outside it is the host
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

	// The anchor's re-assertion (`correctAnchor`) is model-based and runs pre-flush, so it
	// can lag the DOM by a boundary block's height; each tick refines placement AFTER the
	// flush, when DOM reads are exact, and stops once the target stops moving. A SUPERSEDED
	// claim bails at once (the viewport belongs to the newer reveal), but one that merely
	// lost its pin to a user gesture keeps refining — it is still arriving.
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
				placedTop = null; // transiently unmounted mid re-slice — keep settling
				continue;
			}
			// Converged: the anchor correction no longer disturbs the prior precise placement.
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
			// Read SelectionState, not the `data-cross-block` DOM mirror: that attribute is
			// written by a deferred $effect and lags the synchronous selectionChange emit, so
			// a subscriber reading mid-emit would get the parked range as a caret.
			if (deps.isCrossBlock()) return null;
			const root = deps.getEditorRoot();
			if (!root) return null;
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			if (!root.contains(range.commonAncestorContainer)) return null;
			// A caret in the host's header slot is inside the root but is not a document
			// caret; reporting it would float caret-following chrome over the host's field.
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
			// Claim before the first await so the pin survives a clearing gesture that
			// triggered this reveal (a match click's pointerdown releases, then this re-claims).
			const claim = deps.revealAnchor.claim(p, block);
			await deps.revealPath(p);
			// Gated: a claim superseded during a long mount wait would otherwise yank the
			// viewport once, before the settle's first tick could bail it.
			if (!claim.isSuperseded()) deps.getBlockElByPath(p)?.scrollIntoView({ block });
			const landed = await settleInView(p, block, claim);
			// Release on 'center': the anchor holds only a coarse pin, whose later corrections
			// would drift a target the settle already placed exactly. 'nearest' holds by
			// default — the coarse top-pin IS its contract. A failed reveal never pins.
			if (block === 'center' || !landed || opts?.hold === false) claim.release();
			return landed;
		},
		navigateTo(path) {
			return deps.landCaretAt([...path]);
		}
	};
}
