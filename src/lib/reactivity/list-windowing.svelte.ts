/**
 * One windowing wiring unit, instantiated per BlockList-bearing scope (the editor
 * root and every activated nested container). Composes the height oracle, a
 * per-scope Fenwick model, and createBlockWindow; maps the single editor scroll
 * element into this scope's own coordinate range by DOM measurement (spacers keep
 * geometry real at every depth); records measured child heights into the model and
 * reports this scope's own box height up to its parent so ancestor spacers stay correct.
 */
import { tick, untrack } from 'svelte';
import { HeightModel } from '../cursor/height-model';
import type { HeightOracle } from '../cursor/height-oracle';
import { createBlockWindow, type BlockWindow, type WindowResult } from './block-window.svelte';
import { estimateWidth, effectiveViewportHeight } from './scope-geometry';
import { runMeasureBatch, type MeasureEntry } from './measure-batch';
import type { NodeView } from '../core/node-views';
import type { RevealBlock } from '../cursor/reveal-anchor';

export interface ListWindowingDeps {
	oracle: HeightOracle;
	getChildren: () => readonly NodeView[];
	getChildIds: () => string[];
	/** This scope's own list element — its top within the scroll content maps root scrollTop to local. */
	getListEl: () => HTMLElement | null;
	/** The single editor scroll element (the document facet's `editorRoot`). */
	getScrollEl: () => HTMLElement | null;
	/** The focused block's full path, for the per-level pin. */
	getFocusPath: () => number[] | null;
	/** Top-level-ancestor index of an active reveal target (plus the `block` placement
	 *  the reveal asked for), else null. While set, `correctAnchor` holds THAT index at
	 *  the requested placement instead of the top-of-viewport block, so an image-decode
	 *  shrink above it can't clamp the reveal off-screen. Wired on the ROOT scope only
	 *  (single-claimant — nested scopes would fight over one scrollTop). */
	getRevealAnchorTarget?: () => { index: number; block: RevealBlock } | null;
	/** Monotonic counter bumped on an editor WIDTH change (after the oracle's measured
	 *  cache is cleared). Rebuilds the model at the new width and re-measures mounted blocks. */
	getWidthVersion: () => number;
	/** This scope's path (the parentPath its children render under). [] at top level. */
	getParentPath: () => number[];
	/** This scope's own measurable box; re-measured on inner reflow to report a fresh subtotal upward. Absent at top level. */
	getOwnEl?: () => HTMLElement | null;
	/** Report this scope's own box height to the parent scope's setChildSubtotal (undefined at top level). */
	reportSelfHeight?: (height: number) => void;
	/** Collapse clamp: while true this scope mounts ONLY its chrome row (child 0) —
	 *  the returned window is a fixed [0,1) with zero spacers. The window math is
	 *  bypassed, not fed (collapse is height removal; a clamped slice through
	 *  `computeWindow` would emit the hidden body as a giant bottom spacer). */
	isCollapsed?: () => boolean;
	overscan: number;
	pinExtensionCap: number;
	activateAbovePx: number;
	deactivateBelowPx: number;
}

/** A measurable child registered into a scope's batched measure pass. `applyHeight`
 *  writes into this scope's model — `recordMeasuredChild` for a hosted leaf,
 *  `setChildSubtotal` for a `display:contents` row. The scope reads ALL its pending
 *  children before applying ANY write, so a fling that mounts many children costs one
 *  reflow, not one per child. */
export type MeasurableChild = MeasureEntry;

export interface ListWindowing {
	readonly window: WindowResult;
	/** A DIRECTLY-MEASURED leaf: oracle (by id) + model slot. Passive — no scrollTop write. */
	recordMeasuredChild(index: number, id: string, height: number): void;
	/** A PROPAGATED child-container subtotal: oracle + model slot, addressed by index. No anchor correction. */
	setChildSubtotal(index: number, total: number): void;
	/** Enroll a child in this scope's batched measure pass; returns an unregister fn
	 *  to call on the child's unmount. The child is measured on the next pass. */
	registerChild(id: string, child: MeasurableChild): () => void;
	/** Re-measure ONE registered child immediately (its content height changed on edit). */
	measureChildNow(id: string): void;
	/** ResizeObserver path: `observedHeight` is the observer-reported border-box height.
	 *  O(1)-gate against the recorded height and re-measure (anchor-corrected) only on a
	 *  genuine post-mount change, so the no-op mount resize on a fling costs no DOM read. */
	measureChildOnResize(id: string, observedHeight: number): void;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	revealChild(index: number): Promise<void>;
	/** True iff `index` is in the CURRENT mounted window `[start, end)` (inactive ⇒ all
	 *  children mount, so always true; collapsed ⇒ only the chrome row, index 0). Read
	 *  after `revealChild` to prove a reveal landed before waiting on a mount that can
	 *  otherwise never come (VR-5 termination). */
	isInWindow(index: number): boolean;
	dispose(): void;
}

/**
 * Resize-gate decision (pure, unit-tested). A ResizeObserver fires for every newly
 * mounted block — including the no-op mount resize a fling produces — and again on async
 * growth (an image decoding in). Re-measure ONLY when the observed height genuinely
 * differs from the height already recorded for this block, NOT based on which callback
 * delivered it: the cached-remount case can report the grown size in the very FIRST
 * callback, so a callback-order heuristic (skip the first, act on the rest) would drop
 * it and leave the jump uncorrected. `recorded === undefined` means the batched mount
 * pass hasn't measured this block yet — defer to it rather than racing a lone read in on
 * a fling-dirtied layout. Sub-pixel diffs are measurement noise.
 */
export function shouldRemeasureOnResize(recorded: number | undefined, observed: number): boolean {
	if (observed <= 0 || recorded === undefined) return false;
	return Math.abs(recorded - observed) >= 1;
}

// One shared result backs every collapsed scope — frozen so a consumer mutating
// its window cannot silently corrupt sibling scopes through the singleton.
const collapsedWindow: WindowResult = Object.freeze({
	active: true,
	start: 0,
	end: 1,
	topSpacerPx: 0,
	bottomSpacerPx: 0
});

// This scope's list top within the single editor scroll content — the offset that
// maps root scrollTop into this scope's local range. Real at every depth because
// spacers preserve the geometry above the list. Load-bearing for spacer geometry:
// a divergence between the three consumers below would be a coordinate-mapping bug.
function listTopWithinContent(scrollEl: HTMLElement, listEl: HTMLElement): number {
	return (
		listEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
	);
}

export function createListWindowing(deps: ListWindowingDeps): ListWindowing {
	// The id list index-aligned with the CURRENT `model`. Snapshotted (not read live)
	// because a structural rebuild needs the OLD ordering to remap the anchor by id, but
	// by the time the rebuild effect runs `deps.getChildIds()` already reflects the new
	// children. Copied — `innerBlockIds` is mutated in place on splice.
	let modelChildIds: string[] = [];

	function buildModel(): HeightModel {
		const width = estimateWidth(deps.getListEl(), deps.getScrollEl());
		const children = deps.getChildren();
		const ids = deps.getChildIds();
		modelChildIds = ids.slice();
		return new HeightModel(children.map((n, i) => deps.oracle.height(ids[i], n, width)));
	}

	let model = $state<HeightModel>(buildModel());
	let heightVersion = $state(0);

	// Newly-mounted children measure into ONE scope-owned batched pass instead of each
	// measuring in its own effect (which interleaves a layout read with the prior child's
	// write → one forced reflow per mounted block on a fling). Registration mounts the
	// entry; `pending` holds ids awaiting their first measure; the batch effect drains it
	// when the window slides. An edit re-measures its one block directly (`measureChildNow`).
	const registry = new Map<string, MeasurableChild>();
	const pending = new Set<string>();

	// Hold the anchor block's screen position fixed across a height mutation that resizes
	// the top spacer and would otherwise slide the visible content (VR-2). The editor
	// disables native `overflow-anchor`, so nothing else holds the line. The delta is read
	// from the Fenwick model — synchronous and exact — NOT from `getBoundingClientRect`: a
	// model write only marks `$state` dirty, so the spacer's bound `style.height` flushes in
	// a later microtask and a DOM read here would see pre-flush layout (a ~0 delta, a silent
	// no-op).
	function correctAnchor(mutate: () => void): void {
		const scrollEl = deps.getScrollEl();
		const reveal = deps.getRevealAnchorTarget?.() ?? null;
		if (reveal != null && reveal.index < model.size && scrollEl) {
			// A reveal is in flight: re-assert the target's absolute scroll position
			// after the measure shrinks the model, overriding the browser's auto-clamp
			// (which otherwise drags scrollTop off the target as undecoded off-window
			// images measure ~0 and the document shrinks). Delta-compensation can't win
			// this — the clamp outpaces it — so we re-scroll to the target the same way
			// revealChild does. `'center'` re-centers instead of top-pinning, so a
			// centered reveal survives the same shrink. Holds until the user takes over.
			mutate();
			const listEl = deps.getListEl();
			if (listEl) {
				const targetTop = listTopWithinContent(scrollEl, listEl) + model.offsetOf(reveal.index);
				// Center off `scrollEl.clientHeight`, NOT `viewportHeight()`: the reveal anchor
				// is a root-scope claimant (viewport === the editor box), and clientHeight is
				// stable through the shrink, whereas viewportHeight()'s scope-intersection reads
				// listEl geometry mid-mutate — pre-flush and collapsing — and would center off a
				// transiently-tiny viewport. Model reads (offsetOf/heightOf) stay synchronous.
				scrollEl.scrollTop =
					reveal.block === 'center'
						? targetTop - Math.max(0, (scrollEl.clientHeight - model.heightOf(reveal.index)) / 2)
						: targetTop;
				// A programmatic scrollTop write fires no `scroll` event, so the window's
				// derived scrollTop would stay stale and never re-slice — leaving the target
				// windowed OUT at the very position we just scrolled it to (revealChild syncs
				// for exactly this reason). Push it so the window follows and the target mounts.
				win.syncScrollTop();
			}
			return;
		}
		const anchorIndex = model.indexAtOffset(localScrollTop());
		const before = model.offsetOf(anchorIndex);
		mutate();
		const delta = model.offsetOf(anchorIndex) - before;
		if (delta !== 0 && scrollEl) scrollEl.scrollTop += delta;
	}

	// The structural-rebuild variant of correctAnchor. A count change (block inserted or
	// deleted) shifts every index above it, so the numeric `correctAnchor` would measure a
	// DIFFERENT block's offset at the same index N in the new model and over/under-correct by
	// ~one anchor-block height (VR-2 jump on an above-fold edit). Remap by stable id instead:
	// the anchor block's id is captured against the OLD ordering (`modelChildIds`, set at the
	// prior buildModel) and found again in the rebuilt model. Degrades to the numeric path for
	// the width-version trigger (ids unchanged → newIndex === anchorIndex). If the anchor block
	// itself was deleted (not found), skip — there is no surviving block to hold the line.
	function correctAnchorByStableId(mutate: () => void): void {
		const scrollEl = deps.getScrollEl();
		const lst = localScrollTop();
		const anchorIndex = model.indexAtOffset(lst);
		const before = model.offsetOf(anchorIndex);
		const anchorId = modelChildIds[anchorIndex];
		mutate();
		// When this scope has nothing scrolled above the viewport top (lst === 0), the
		// top-of-viewport block belongs to an ancestor scope, not this one — there is no
		// local anchor to hold. A nonzero delta here can only come from the anchor block
		// being relocated WITHIN this scope (a sibling reorder, or a new first child), and
		// following it would shift the shared scrollTop spuriously (the reorder scroll-drift
		// bug). The numeric correctAnchor needs no such guard: it measures offsetOf(the same
		// index), which is 0 at lst === 0 regardless of relocation.
		if (lst === 0) return;
		const newIndex = anchorId !== undefined ? modelChildIds.indexOf(anchorId) : -1;
		if (newIndex === -1) return;
		const delta = model.offsetOf(newIndex) - before;
		if (delta !== 0 && scrollEl) scrollEl.scrollTop += delta;
	}

	// Rebuild on ANY structural child change — count OR a same-length permutation
	// (reorder) — or an editor WIDTH change (prose re-wraps, so every height the oracle
	// cached is stale; `widthVersion` is bumped after the cache is cleared). Never per
	// keystroke. Keying on the id SEQUENCE (not just its length) is load-bearing: a
	// reorder that left the count unchanged would otherwise skip the rebuild, stranding
	// `modelChildIds` and the per-index heights in the old order until the next
	// count-change rebuild remapped the anchor off a stale id (a one-shot scroll jump).
	// Build inside `untrack` so the effect doesn't subscribe to every child's raw via the
	// oracle. The rebuild reseeds EVERY slot, a wholesale offset shift the flush-pass
	// correction can't see (its before-snapshot is captured after this ran), so
	// anchor-correct the reseed itself to keep the viewport stable — by stable id, so an
	// insert/delete/reorder above the anchor remaps to the surviving block instead of
	// index N's new occupant.
	$effect(() => {
		const ids = deps.getChildIds();
		for (let i = 0; i < ids.length; i++) void ids[i];
		void deps.getScrollEl();
		void deps.getWidthVersion();
		untrack(() => {
			correctAnchorByStableId(() => {
				model = buildModel();
				heightVersion++;
			});
		});
	});

	// Map the single scroll element's scrollTop into this scope's local range.
	function localScrollTop(): number {
		const scrollEl = deps.getScrollEl();
		const listEl = deps.getListEl();
		if (!scrollEl || !listEl) return 0;
		return Math.max(0, scrollEl.scrollTop - listTopWithinContent(scrollEl, listEl));
	}

	// Window each scope against its OWN slice of the viewport, not the full editor
	// height — otherwise N stacked active scopes each mount a full viewport's worth
	// of blocks (O(viewport × scopes)). Falls back to the full height when either
	// element is unmounted (windowing it as the whole viewport is the safe default).
	function viewportHeight(): number {
		const scrollEl = deps.getScrollEl();
		const listEl = deps.getListEl();
		if (!scrollEl) return 0;
		if (!listEl) return scrollEl.clientHeight;
		const scrollRect = scrollEl.getBoundingClientRect();
		const listRect = listEl.getBoundingClientRect();
		return effectiveViewportHeight(
			scrollRect.top,
			scrollEl.clientHeight,
			listRect.top,
			listRect.height
		);
	}

	// This scope's pin: the focused path's index AT this scope's depth, iff the
	// focus path descends through this scope; else null.
	function pinnedIndex(): number | null {
		const fp = deps.getFocusPath();
		const pp = deps.getParentPath();
		if (!fp || fp.length <= pp.length) return null;
		for (let i = 0; i < pp.length; i++) if (fp[i] !== pp[i]) return null;
		return fp[pp.length];
	}

	const win: BlockWindow = createBlockWindow({
		getModel: () => {
			void heightVersion;
			return model;
		},
		getScrollEl: deps.getScrollEl,
		getLocalScrollTop: localScrollTop,
		getViewportHeight: viewportHeight,
		getPinnedIndex: pinnedIndex,
		overscan: deps.overscan,
		pinExtensionCap: deps.pinExtensionCap,
		activateAbovePx: deps.activateAbovePx,
		deactivateBelowPx: deps.deactivateBelowPx
	});

	// The EFFECTIVE window — the collapse clamp substituted at the returned surface.
	// A derived over `isCollapsed()`, so a metadata-driven flip re-renders with no
	// extra plumbing; while collapsed it doesn't read `win.result`, so the bypassed
	// math (and createBlockWindow's hysteresis tracking) never observes the clamp.
	const effectiveWindow = $derived.by(() => (deps.isCollapsed?.() ? collapsedWindow : win.result));

	// Report this scope's own BOX height upward when its inner window reflows.
	// Children measuring in resize the spacers, so the box height the parent measured
	// at this container's mount goes stale; re-measure on heightVersion and push it up.
	// BOX height (chrome included) — not model.total() — so it matches what this
	// container's own BlockHost measured, avoiding a two-writer fight on the parent slot.
	$effect(() => {
		void heightVersion;
		const el = deps.getOwnEl?.();
		if (!el || !deps.reportSelfHeight) return;
		const h = el.getBoundingClientRect().height;
		if (h > 0) deps.reportSelfHeight(h);
	});

	// The scope's batched measure pass for NEWLY-MOUNTED children. Svelte runs effects
	// post-render, so this fires after a flush mounts children — the framework-native
	// trigger the spec requires (no microtask/rAF/timeout).
	//
	// It tracks the EFFECTIVE window only — a coalesced signal that already moves when the
	// mounted set slides, including the collapse flip (the raw result can be identical across
	// an expand, stranding the remounted children's measurements in `pending` until the next
	// scroll). Registration deliberately does NOT bump reactive state: the mount that
	// registers a child already moved the window, so a per-child trigger would re-enter this
	// effect O(children) times in one flush and trip Svelte's update-depth guard.
	$effect(() => {
		void effectiveWindow;
		untrack(() => flushMeasurements());
	});

	// Re-measure currently-mounted children after a WIDTH change. The rebuild above reseeds
	// every slot from the new-width ESTIMATE, but mounted blocks have real (old-width) heights
	// that no longer match how they wrap now. Their measure effects key on `node.raw`, not
	// width, so they won't re-fire on resize — re-enroll every registered id and drain here
	// (rather than leaving it for the window-tracking batch effect) so the re-measure lands on
	// the resize frame regardless of effect order.
	$effect(() => {
		void deps.getWidthVersion();
		untrack(() => {
			for (const id of registry.keys()) pending.add(id);
			flushMeasurements();
		});
	});

	function flushMeasurements(): void {
		if (pending.size === 0) return;
		const entries: MeasurableChild[] = [];
		for (const id of pending) {
			const child = registry.get(id);
			if (child) entries.push(child);
		}
		pending.clear();
		// The batch's writes grow/shrink model slots, including above-viewport ones, so
		// wrap it in the anchor correction to keep the top-of-viewport block fixed.
		correctAnchor(() => runMeasureBatch(entries));
	}

	// Re-measure ONE block and anchor-correct. Read the height BEFORE correctAnchor so no
	// DOM read follows the model write, and a block at or below the anchor yields a zero
	// delta (no scroll move for in-view edits). The write is convergence-guarded
	// (`recordMeasuredChild` no-ops once the height settles), so a redundant call can't
	// spin the reactive graph.
	function measureOne(id: string): void {
		const child = registry.get(id);
		if (!child) return;
		const h = child.readHeight();
		if (h > 0) correctAnchor(() => child.applyHeight(h));
	}

	return {
		get window() {
			return effectiveWindow;
		},
		// Directly-measured leaf. PASSIVE — no scrollTop correction here; anchor
		// stability rides estimate quality plus the spacers.
		recordMeasuredChild(index, id, height) {
			deps.oracle.recordMeasured(id, height);
			if (index < model.size && model.heightOf(index) !== height) {
				model.setHeight(index, height);
				heightVersion++;
			}
		},
		// Propagated child-container subtotal: model slot + oracle, by this child's id.
		// List items aren't BlockHosts and have no other oracle writer, so without this
		// write a parent rebuild (buildModel re-seeds every slot from oracle.height,
		// falling back to estimate) discards their measured heights and the viewport
		// jumps. For hosted children the write is idempotent — their own BlockHost already
		// records the same box under the same id. No anchor correction either way, so a
		// deep leaf measurement updates each ancestor's slot without cascading scrollTop
		// fixes up the chain.
		setChildSubtotal(index, total) {
			const id = deps.getChildIds()[index];
			if (id !== undefined) deps.oracle.recordMeasured(id, total);
			if (index < model.size && model.heightOf(index) !== total) {
				model.setHeight(index, total);
				heightVersion++;
			}
		},
		// Enroll without touching reactive state: the mount that registers this child
		// already moved the window, which re-runs the batch effect to drain `pending`.
		registerChild(id, child) {
			registry.set(id, child);
			pending.add(id);
			return () => {
				registry.delete(id);
				pending.delete(id);
			};
		},
		// An edit re-wrapped this block; re-measure it precisely (raw changed, so the
		// height almost certainly did too — no point gating).
		measureChildNow(id) {
			measureOne(id);
		},
		// ResizeObserver path for async growth (an image decoding in). `observedHeight` is
		// the observer-reported border-box height — same box as getBoundingClientRect. The
		// gate reads the oracle's recorded height (O(1), no DOM), so the no-op mount resize
		// a fling fires for every newly-mounted block returns without a getBoundingClientRect
		// on the spacer-dirtied layout (VR-4). Only a genuine post-mount change falls through
		// to the precise, anchor-corrected re-measure.
		measureChildOnResize(id, observedHeight) {
			if (shouldRemeasureOnResize(deps.oracle.measured(id), observedHeight)) measureOne(id);
		},
		async revealChild(index) {
			// A clamped-out body child can never mount — no scroll can reveal it, so
			// degrade (the caller falls back to path state) instead of scroll-and-wait.
			if (index >= 1 && deps.isCollapsed?.()) return;
			const scrollEl = deps.getScrollEl();
			const listEl = deps.getListEl();
			if (!scrollEl || !listEl) return;
			scrollEl.scrollTop =
				listTopWithinContent(scrollEl, listEl) + model.offsetOf(Math.min(index, model.size));
			win.syncScrollTop();
			await tick();
		},
		isInWindow(index) {
			// Reads the EFFECTIVE result: while collapsed only index 0 is a member.
			// Mandatory — the unclamped inactive-window oracle answers true for every
			// index, so revealChildOrWait's degrade check would never fire and a reveal
			// into the collapsed body would await a mount that can never come (VR-5).
			const { start, end } = effectiveWindow;
			return index >= start && index < end;
		},
		dispose() {
			win.dispose();
		}
	};
}
