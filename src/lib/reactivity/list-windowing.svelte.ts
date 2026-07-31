/**
 * One windowing wiring unit per BlockList-bearing scope (the editor root and every
 * activated nested container). Composes the height oracle, a per-scope Fenwick model, and
 * `createBlockWindow`; maps the single editor scroll element into this scope's coordinate
 * range by DOM measurement, and reports this scope's own box height upward so ancestor
 * spacers stay correct. See `docs/design/virtual-rendering.md`.
 */
import { tick, untrack } from 'svelte';
import { HeightModel } from '../cursor/height-model';
import type { HeightOracle } from '../cursor/height-oracle';
import { createBlockWindow, type BlockWindow, type WindowResult } from './block-window.svelte';
import { estimateWidth, effectiveViewportHeight } from './scope-geometry';
import { runMeasureBatch, type MeasureEntry } from './measure-batch';
import type { NodeView } from '../core/node-views';
import type { RevealBlock } from '../cursor/reveal-anchor';

/**
 * An active reveal target in one scope's coordinates. The model addresses only this
 * scope's own children, so a nested target arrives as its top-level ancestor's `index`
 * plus the measured drop down to the target — pinning the block the reveal aimed at
 * rather than its container.
 */
export interface RevealAnchorPlacement {
	index: number;
	block: RevealBlock;
	/** Drop from the ancestor's top to the target's top; 0 when the target IS the ancestor. */
	innerOffset: number;
	/** The target's own height, for `'center'`; null when it can't be measured. */
	height: number | null;
}

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
	/** Where an active reveal target sits in this scope's coordinates, else null. While set,
	 *  `correctAnchor` holds THAT position instead of the top-of-viewport block. Wired on
	 *  the ROOT scope only — nested scopes would fight over one scrollTop. */
	getRevealAnchorTarget?: () => RevealAnchorPlacement | null;
	/** Monotonic counter bumped on an editor WIDTH change (after the oracle's measured
	 *  cache is cleared). Rebuilds the model at the new width and re-measures mounted blocks. */
	getWidthVersion: () => number;
	/** This scope's path (the parentPath its children render under). [] at top level. */
	getParentPath: () => number[];
	/** This scope's own measurable box; re-measured on inner reflow to report a fresh subtotal upward. Absent at top level. */
	getOwnEl?: () => HTMLElement | null;
	/** Report this scope's own box height to the parent scope's setChildSubtotal (undefined at top level). */
	reportSelfHeight?: (height: number) => void;
	/** False in host-scroll mode: this scope never activates, so every child mounts and
	 *  no spacer renders. Static — the flag is set once at mount. */
	windowingEnabled: () => boolean;
	/** Collapse clamp: while true this scope mounts ONLY its chrome row, a fixed [0,1) with
	 *  zero spacers. The window math is bypassed, not fed — collapse is height removal, and
	 *  a clamped slice through `computeWindow` would emit the body as a giant spacer. */
	isCollapsed?: () => boolean;
	overscan: number;
	pinExtensionCap: number;
	activateAbovePx: number;
	deactivateBelowPx: number;
}

/** A measurable child in a scope's batched measure pass. The scope reads ALL pending
 *  children before applying ANY write, so a fling that mounts many costs one reflow. */
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
	/** ResizeObserver path: O(1)-gate `observedHeight` against the recorded height and
	 *  re-measure only on a genuine post-mount change, so the no-op mount resize on a fling
	 *  costs no DOM read. */
	measureChildOnResize(id: string, observedHeight: number): void;
	/**
	 * True when the scroll position IS the reveal target's requested placement. Asked by
	 * any writer that would otherwise add a relative delta to the same scrollTop: the
	 * anchor derives its position from live geometry, so a delta on top double-counts.
	 * A question, never a write — re-placing here would drag the reader to the top pin on
	 * a resize they only wanted compensated. Root scope only; nested scopes answer false.
	 */
	revealHoldsScroll(): boolean;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	revealChild(index: number): Promise<void>;
	/** True iff `index` is in the CURRENT mounted window (inactive ⇒ always true; collapsed
	 *  ⇒ only the chrome row). Read after `revealChild` to prove a reveal landed before
	 *  waiting on a mount that can otherwise never come (VR-5 termination). */
	isInWindow(index: number): boolean;
	dispose(): void;
}

/**
 * Resize-gate decision (pure, unit-tested). Keyed on the height DIFFERING from what is
 * recorded, never on which callback delivered it: a cached remount can report the grown
 * size in the very first callback, so a callback-order heuristic would drop it.
 * `recorded === undefined` means the batched mount pass hasn't measured this block yet —
 * defer to it rather than racing a lone read in on a fling-dirtied layout.
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

// This scope's list top within the editor scroll content — the offset mapping root
// scrollTop into this scope's local range, real at every depth because spacers preserve
// the geometry above the list. One home: a divergence between its consumers below would
// be a coordinate-mapping bug.
function listTopWithinContent(scrollEl: HTMLElement, listEl: HTMLElement): number {
	return (
		listEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
	);
}

export function createListWindowing(deps: ListWindowingDeps): ListWindowing {
	// The id list index-aligned with the CURRENT `model`. Snapshotted, not read live: a
	// structural rebuild needs the OLD ordering to remap the anchor by id, and by then
	// `getChildIds()` already reflects the new children. Copied — it is spliced in place.
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

	// One scope-owned batched pass rather than a per-child effect, which would interleave a
	// layout read with the prior child's write → one forced reflow per mounted block on a
	// fling. `pending` holds ids awaiting their first measure; the batch effect drains it.
	const registry = new Map<string, MeasurableChild>();
	const pending = new Set<string>();

	/**
	 * The scrollTop putting the active reveal target at its requested placement, or null
	 * when no reveal is in flight. The one definition of "where the target belongs",
	 * shared by the writer that moves there and the predicate that asks if we already are.
	 * The ancestor's offset comes from the Fenwick model, never `getBoundingClientRect`: a
	 * model write only marks `$state` dirty, so a DOM read here would see pre-flush layout.
	 */
	function revealTargetScrollTop(): number | null {
		const scrollEl = deps.getScrollEl();
		const listEl = deps.getListEl();
		const reveal = deps.getRevealAnchorTarget?.() ?? null;
		if (reveal == null || reveal.index >= model.size || !scrollEl || !listEl) return null;

		const targetTop =
			listTopWithinContent(scrollEl, listEl) + model.offsetOf(reveal.index) + reveal.innerOffset;
		// Center off `scrollEl.clientHeight`, NOT `viewportHeight()`: clientHeight is stable
		// through the shrink, whereas the scope-intersection reads listEl geometry mid-mutate
		// and would center off a transiently-tiny viewport.
		const targetHeight = reveal.height ?? model.heightOf(reveal.index);
		return reveal.block === 'center'
			? targetTop - Math.max(0, (scrollEl.clientHeight - targetHeight) / 2)
			: targetTop;
	}

	function placeRevealTarget(): boolean {
		const targetScrollTop = revealTargetScrollTop();
		const scrollEl = deps.getScrollEl();
		if (targetScrollTop === null || !scrollEl) return false;
		scrollEl.scrollTop = targetScrollTop;
		// A programmatic scrollTop write fires no `scroll` event, so the window's derived
		// scrollTop would stay stale and leave the target windowed OUT at the very position
		// we just scrolled it to.
		win.syncScrollTop();
		return true;
	}

	/**
	 * The reveal claim outranks either anchor rule: the target's absolute position is
	 * re-asserted after the mutation, overriding the browser's auto-clamp (which drags
	 * scrollTop off the target as undecoded off-window images measure ~0). Delta
	 * compensation can't win — the clamp outpaces it. Returns true when it ran the
	 * mutation and owns the scroll position; shared because BOTH correctors need it.
	 */
	function reassertRevealAnchor(mutate: () => void): boolean {
		const reveal = deps.getRevealAnchorTarget?.() ?? null;
		if (reveal == null || reveal.index >= model.size || !deps.getScrollEl()) return false;
		mutate();
		placeRevealTarget();
		return true;
	}

	// Hold the anchor block's screen position across a height mutation that would otherwise
	// slide the visible content (VR-2) — the editor disables native `overflow-anchor`, so
	// nothing else holds the line. The delta comes from the Fenwick model, not
	// `getBoundingClientRect`: a model write only marks `$state` dirty, so a DOM read here
	// would see pre-flush layout and a ~0 delta.
	function correctAnchor(mutate: () => void): void {
		if (reassertRevealAnchor(mutate)) return;
		const scrollEl = deps.getScrollEl();
		const anchorIndex = model.indexAtOffset(localScrollTop());
		const before = model.offsetOf(anchorIndex);
		mutate();
		const delta = model.offsetOf(anchorIndex) - before;
		if (delta !== 0 && scrollEl) scrollEl.scrollTop += delta;
	}

	// The structural-rebuild variant of correctAnchor. A count change shifts every index
	// above it, so the numeric form would measure a DIFFERENT block at index N and mis-correct
	// by ~one anchor-block height (VR-2 jump on an above-fold edit). Remap by stable id
	// instead, captured against the OLD ordering in `modelChildIds`; a deleted anchor has no
	// surviving block to hold the line, so skip.
	function correctAnchorByStableId(mutate: () => void): void {
		if (reassertRevealAnchor(mutate)) return;
		const scrollEl = deps.getScrollEl();
		const lst = localScrollTop();
		const anchorIndex = model.indexAtOffset(lst);
		const before = model.offsetOf(anchorIndex);
		const anchorId = modelChildIds[anchorIndex];
		mutate();
		// At lst === 0 the top-of-viewport block belongs to an ancestor scope, so there is no
		// local anchor: a nonzero delta could only come from the anchor being relocated
		// within this scope, and following it would shift the shared scrollTop spuriously.
		// The numeric form needs no such guard — its offsetOf(same index) is 0 here anyway.
		if (lst === 0) return;
		const newIndex = anchorId !== undefined ? modelChildIds.indexOf(anchorId) : -1;
		if (newIndex === -1) return;
		const delta = model.offsetOf(newIndex) - before;
		if (delta !== 0 && scrollEl) scrollEl.scrollTop += delta;
	}

	// Rebuild on any structural child change or an editor WIDTH change, never per keystroke.
	// Keying on the id SEQUENCE rather than its length is load-bearing: a reorder leaving the
	// count unchanged would skip the rebuild and strand `modelChildIds` in the old order.
	// Build inside `untrack` so the effect doesn't subscribe to every child's raw via the
	// oracle. The reseed is a wholesale offset shift the flush-pass correction can't see, so
	// anchor-correct it here — by stable id, to survive an insert/delete above the anchor.
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

	// Each scope windows against its OWN slice of the viewport: against the full editor
	// height, N stacked active scopes would each mount a viewport's worth of blocks. Falls
	// back to the full height when either element is unmounted.
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

	// This scope's pin: the focused path's index at this scope's depth, iff the focus path
	// descends through this scope.
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
		windowingEnabled: deps.windowingEnabled,
		overscan: deps.overscan,
		pinExtensionCap: deps.pinExtensionCap,
		activateAbovePx: deps.activateAbovePx,
		deactivateBelowPx: deps.deactivateBelowPx
	});

	// The collapse clamp substituted at the returned surface. While collapsed this doesn't
	// read `win.result`, so the bypassed math (and the hysteresis tracking) never observes
	// the clamp.
	const effectiveWindow = $derived.by(() => (deps.isCollapsed?.() ? collapsedWindow : win.result));

	// Children measuring in resize the spacers, so the box height the parent measured at
	// this container's mount goes stale. BOX height, not `model.total()`, so it matches what
	// this container's own BlockHost measured — otherwise two writers fight over the slot.
	$effect(() => {
		void heightVersion;
		const el = deps.getOwnEl?.();
		if (!el || !deps.reportSelfHeight) return;
		const h = el.getBoundingClientRect().height;
		if (h > 0) deps.reportSelfHeight(h);
	});

	// The batched measure pass for NEWLY-MOUNTED children, keyed on the EFFECTIVE window: the
	// raw result can be identical across a collapse expand, stranding remounted children in
	// `pending` until the next scroll. Registration deliberately does NOT bump reactive
	// state — the mount that registers a child already moved the window, so a per-child
	// trigger would re-enter this effect O(children) times and trip the update-depth guard.
	$effect(() => {
		void effectiveWindow;
		untrack(() => flushMeasurements());
	});

	// Re-measure mounted children after a WIDTH change: the rebuild above reseeds every slot
	// from the new-width estimate, but mounted blocks hold real old-width heights and their
	// measure effects key on `node.raw`, not width. Drained here rather than by the
	// window-tracking effect so the re-measure lands on the resize frame either way.
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
		// The batch writes above-viewport slots too, so the anchor correction keeps the
		// top-of-viewport block fixed.
		correctAnchor(() => runMeasureBatch(entries));
	}

	// Read the height BEFORE correctAnchor so no DOM read follows the model write. The write
	// is convergence-guarded (`recordMeasuredChild` no-ops once the height settles), so a
	// redundant call can't spin the reactive graph.
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
		// PASSIVE — no scrollTop correction; anchor stability rides estimate quality plus
		// the spacers.
		recordMeasuredChild(index, id, height) {
			deps.oracle.recordMeasured(id, height);
			if (index < model.size && model.heightOf(index) !== height) {
				model.setHeight(index, height);
				heightVersion++;
			}
		},
		// List items aren't BlockHosts and have no other oracle writer, so without this write
		// a parent rebuild would reseed their slots from estimates and the viewport jumps.
		// Idempotent for hosted children. No anchor correction, so a deep leaf measurement
		// updates each ancestor's slot without cascading scrollTop fixes up the chain.
		setChildSubtotal(index, total) {
			const id = deps.getChildIds()[index];
			if (id !== undefined) deps.oracle.recordMeasured(id, total);
			if (index < model.size && model.heightOf(index) !== total) {
				model.setHeight(index, total);
				heightVersion++;
			}
		},
		// Enroll without touching reactive state: the mount that registers this child already
		// moved the window, which re-runs the batch effect to drain `pending`.
		registerChild(id, child) {
			registry.set(id, child);
			pending.add(id);
			return () => {
				registry.delete(id);
				pending.delete(id);
			};
		},
		// Ungated: raw changed, so the height almost certainly did too.
		measureChildNow(id) {
			measureOne(id);
		},
		// ResizeObserver path for async growth. The gate reads the oracle's recorded height
		// (O(1), no DOM), so the no-op mount resize a fling fires for every newly-mounted
		// block returns without a rect read on the spacer-dirtied layout (VR-4).
		measureChildOnResize(id, observedHeight) {
			if (shouldRemeasureOnResize(deps.oracle.measured(id), observedHeight)) measureOne(id);
		},
		revealHoldsScroll() {
			const targetScrollTop = revealTargetScrollTop();
			const scrollEl = deps.getScrollEl();
			// Sub-pixel tolerance: the settle's own refinement lands a fraction of a device
			// pixel off the model-derived position, and a strict compare would re-admit the delta.
			return (
				targetScrollTop !== null &&
				!!scrollEl &&
				Math.abs(scrollEl.scrollTop - targetScrollTop) <= 1
			);
		},
		async revealChild(index) {
			// A clamped-out body child can never mount, so degrade instead of scroll-and-wait.
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
			// The EFFECTIVE result, mandatorily: the unclamped inactive window answers true
			// for every index, so a reveal into a collapsed body would await a mount that can
			// never come (VR-5).
			const { start, end } = effectiveWindow;
			return index >= start && index < end;
		},
		dispose() {
			win.dispose();
		}
	};
}
