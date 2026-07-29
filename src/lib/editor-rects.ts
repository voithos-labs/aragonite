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
import { tick } from 'svelte';
import type { BlockComponent } from './block-component';
import type { RevealAnchorState, RevealClaim } from './cursor/reveal-anchor';

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
	/**
	 * Reveal (mount) the block at `path`, then scroll the viewport to it. `block`
	 * defaults to `'nearest'` (bring minimally into view); `'center'` centers it.
	 * `hold` (default true) keeps the reveal's pin after the call resolves, so a
	 * later layout shift cannot push the target back out of view; pass false to
	 * hand the viewport straight back, which is what a consumer restoring a caret
	 * AND its own remembered scroll needs.
	 *
	 * Division of responsibility (the reveal anchor vs the scroll). A windowed-out
	 * target past undecoded images would strand a plain `scrollIntoView` — the images
	 * reserve height off-window and collapse on mount, so the document shrinks and the
	 * browser clamps the scroll off the target. So `scrollTo` claims the reveal anchor
	 * (`cursor/reveal-anchor.ts`) at the requested `block`; the top-level windowing
	 * scope's `correctAnchor` then re-asserts that placement on every post-mount measure
	 * pass — mounting the target at the anchored position and holding it against the
	 * shrink. The anchor is model-based, so it is exact enough for `'nearest'` (a
	 * top-pin, where visibility is the whole contract) but only coarse for `'center'`;
	 * `scrollTo` therefore refines `'center'` to exact placement with `scrollIntoView`
	 * once the target is mounted, then releases its claim (a persistent coarse pin
	 * would drift the centered target). `'nearest'` holds by default, matching the
	 * search reveal band. The boolean resolves only after the position settles, so a
	 * resolved `true` means the target is genuinely in view; a target that never
	 * mounts resolves `false` and leaves no dangling anchor.
	 *
	 * A reveal superseded by a later one stops refining and reports honest
	 * visibility — usually `false`, since the viewport now belongs to the newer
	 * target. Two navigations racing therefore settle on the newer one instead of
	 * fighting over the scroll for the rest of the older one's settle.
	 *
	 * Host-scroll mode drops the anchor half entirely — windowing never activates, so
	 * there is nothing to hold against and no scrollport of our own to hold it in. The
	 * settle's `scrollIntoView` (which walks up to the host's scroller) is the whole
	 * mechanism, and visibility is judged against the window viewport intersected
	 * with every ancestor that clips the editor.
	 */
	scrollTo(
		path: readonly number[],
		opts?: { block?: 'nearest' | 'center'; hold?: boolean }
	): Promise<boolean>;
	/**
	 * Navigate to `path`: reveal, scroll, and land the caret at the block's start.
	 * What a navigation affordance (a table-of-contents entry, an outline click)
	 * owes the user — after activating it the next keystroke, Ctrl+Z included,
	 * addresses the document rather than the affordance's own button. Runs the same
	 * restore road undo and the consumer `setSelection` door use, so a navigation
	 * and a restore cannot diverge on how a target is resolved, clamped or revealed.
	 * Resolves true when the caret landed.
	 */
	navigateTo(path: readonly number[]): Promise<boolean>;
}

// Post-mount measure passes settle within a few Svelte flushes (each re-asserts the
// reveal anchor); ride `tick` — the repo's only sequencing primitive — for a bounded
// wait, then report honest visibility. Generous enough to absorb a multi-pass window
// re-slice, small enough to stay imperceptible.
const REVEAL_SETTLE_TICKS = 12;

export function createEditorRects(deps: {
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	getBlockComponentByPath: (path: number[]) => BlockComponent | null;
	revealPath: (path: number[]) => Promise<unknown>;
	getEditorRoot: () => HTMLElement | null;
	/** True when an ancestor owns the scroll (`scrollMode="host"`), so the root is
	 *  no scrollport: it spans the WHOLE document, and intersecting a block with it
	 *  answers "is this in the document" — true even for a block nothing can reveal. */
	isHostScroll: () => boolean;
	/** Host mode's ancestors that bound what can be seen. Intersected WITH the window
	 *  viewport, never instead of it: the innermost bound may be a card that clips
	 *  nothing, and it would swallow the fold the window enforces. */
	getClipBounds: () => HTMLElement[];
	isCrossBlock: () => boolean;
	/** True for nodes in the host's `header` slot — inside the root, but not this
	 *  editor's content. */
	isHostChrome: (node: Node | null) => boolean;
	revealAnchor: RevealAnchorState;
	/** Land a caret at the start of `path` through the shared restore road. Injected
	 *  because this surface owns geometry, not the selection model — and the road it
	 *  runs re-enters `scrollTo` for the reveal half. */
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

	// Settle the reveal into its final placement, then report whether it landed in view.
	// The reveal anchor (`correctAnchor`) coarsely re-asserts the target on every
	// post-mount measure pass — enough to keep it from stranding off-screen, but it is
	// model-based and runs mid-mutate (pre-flush), so it can lag the DOM by a boundary
	// block's height. So each tick refines the placement AFTER the flush, when DOM reads
	// are exact and `scrollIntoView` therefore gets the last word over that pass's coarse
	// anchor correction, and stops once the target stops moving (shrink done, the anchor
	// and the refine agree). A superseded claim stops refining at once: the viewport
	// belongs to the newer reveal, and two settle loops scrolling to different targets
	// would fight for the rest of this one's window. In a bare harness with no editor
	// root there is no viewport to measure against, so presence is the read.
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
			if (!claim.isCurrent()) break;
			const el = deps.getBlockElByPath(path);
			if (!el) {
				placedTop = null; // transiently unmounted mid re-slice — keep settling
				continue;
			}
			// Converged once the tick's anchor correction no longer disturbs the prior
			// precise placement: the model has caught up to the DOM, so the coarse anchor
			// and the refine now agree and no post-resolve pass will move the target.
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
			// A caret in the host's header slot is inside the root but is not a
			// document caret: reporting it would float a consumer's caret-following
			// chrome over the host's own title field.
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
			// triggered this reveal (a Previous-match click's pointerdown releases, then
			// this re-claims) — the seam that owns strand-resistance for every navigation.
			const claim = deps.revealAnchor.claim(p, block);
			await deps.revealPath(p);
			deps.getBlockElByPath(p)?.scrollIntoView({ block });
			const landed = await settleInView(p, block, claim);
			// 'center' needs exact placement, which the model-based anchor holds only
			// coarsely (it can lag the DOM by a boundary block); the settle refined it
			// precisely via scrollIntoView, so release — otherwise its coarse correction
			// on a later measure pass would drift the centered target. 'nearest' holds by
			// default, for durable visibility (the search band), where the coarse top-pin
			// IS the contract. A failed reveal always releases — no dangling pin. Every
			// arm goes through the claim, so a superseded reveal's release is a no-op
			// rather than a fresher claimant's loss.
			if (block === 'center' || !landed || opts?.hold === false) claim.release();
			return landed;
		},
		navigateTo(path) {
			return deps.landCaretAt([...path]);
		}
	};
}
