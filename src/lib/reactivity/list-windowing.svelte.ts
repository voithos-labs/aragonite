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
import type { CstNode } from '../core/nodes';

export interface ListWindowingDeps {
	oracle: HeightOracle;
	getChildren: () => CstNode[];
	getChildIds: () => string[];
	/** This scope's own list element — its top within the scroll content maps root scrollTop to local. */
	getListEl: () => HTMLElement | null;
	/** The single editor scroll element (EDITOR_ROOT_KEY). */
	getScrollEl: () => HTMLElement | null;
	/** The focused block's full path, for the per-level pin. */
	getFocusPath: () => number[] | null;
	/** Monotonic counter bumped on an editor WIDTH change (after the oracle's measured
	 *  cache is cleared). Rebuilds the model at the new width and re-measures mounted blocks. */
	getWidthVersion: () => number;
	/** This scope's path (the parentPath its children render under). [] at top level. */
	getParentPath: () => number[];
	/** This scope's own measurable box; re-measured on inner reflow to report a fresh subtotal upward. Absent at top level. */
	getOwnEl?: () => HTMLElement | null;
	/** Report this scope's own box height to the parent scope's setChildSubtotal (undefined at top level). */
	reportSelfHeight?: (height: number) => void;
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
	/** A PROPAGATED child-container subtotal: model slot ONLY, by index. No oracle, no id, no anchor. */
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
	 *  children mount, so always true). Read after `revealChild` to prove a reveal landed
	 *  before waiting on a mount that can otherwise never come (VR-5 termination). */
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

	// Rebuild on structural child-count change or an editor WIDTH change (prose re-wraps, so
	// every height the oracle cached is stale; `widthVersion` is bumped after the cache is
	// cleared). Never per keystroke. Build inside `untrack` so the effect doesn't subscribe
	// to every child's raw via the oracle. The rebuild reseeds EVERY slot, a wholesale offset
	// shift the flush-pass correction can't see (its before-snapshot is captured after this
	// ran), so anchor-correct the reseed itself to keep the viewport stable — by stable id, so
	// an insert/delete above the anchor remaps to the surviving block instead of index N's new
	// occupant.
	$effect(() => {
		void deps.getChildren().length;
		void deps.getScrollEl();
		void deps.getWidthVersion();
		untrack(() => {
			correctAnchorByStableId(() => {
				model = buildModel();
				heightVersion++;
			});
		});
	});

	// Map the single scroll element's scrollTop into this scope's local range. The
	// list's own top within the scroll content is real because spacers preserve it.
	function localScrollTop(): number {
		const scrollEl = deps.getScrollEl();
		const listEl = deps.getListEl();
		if (!scrollEl || !listEl) return 0;
		const offsetWithinContent =
			listEl.getBoundingClientRect().top -
			scrollEl.getBoundingClientRect().top +
			scrollEl.scrollTop;
		return Math.max(0, scrollEl.scrollTop - offsetWithinContent);
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
	// It tracks the WINDOW only — a coalesced signal that already moves when the mounted set
	// slides. Registration deliberately does NOT bump reactive state: the mount that
	// registers a child already moved the window, so a per-child trigger would re-enter this
	// effect O(children) times in one flush and trip Svelte's update-depth guard.
	$effect(() => {
		void win.result;
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
			return win.result;
		},
		// Directly-measured leaf. PASSIVE — no active scrollTop correction, matching
		// Phase 2's measure path (anchor stability rides estimate quality + spacers).
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
			const scrollEl = deps.getScrollEl();
			const listEl = deps.getListEl();
			if (!scrollEl || !listEl) return;
			const listTop =
				listEl.getBoundingClientRect().top -
				scrollEl.getBoundingClientRect().top +
				scrollEl.scrollTop;
			scrollEl.scrollTop = listTop + model.offsetOf(Math.min(index, model.size));
			win.syncScrollTop();
			await tick();
		},
		isInWindow(index) {
			const { start, end } = win.result;
			return index >= start && index < end;
		},
		dispose() {
			win.dispose();
		}
	};
}
