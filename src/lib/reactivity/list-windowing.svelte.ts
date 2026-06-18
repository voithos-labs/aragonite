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
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	revealChild(index: number): Promise<void>;
	dispose(): void;
}

export function createListWindowing(deps: ListWindowingDeps): ListWindowing {
	function buildModel(): HeightModel {
		const width = estimateWidth(deps.getListEl(), deps.getScrollEl());
		const children = deps.getChildren();
		const ids = deps.getChildIds();
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

	// Hold the anchor block's screen position fixed across a height mutation. A measure-in
	// or a width rebuild changes the heights of blocks ABOVE the viewport, which grows or
	// shrinks the top spacer and slides the visible content with no compensation (VR-2).
	// The fix is the spec's manual correction (the editor disables native `overflow-anchor`,
	// so nothing else holds the line): record the top-of-viewport block's offset before the
	// mutation, recompute it after, and shift `scrollTop` by the delta. The delta is read
	// from the Fenwick model — synchronous and exact — NOT from `getBoundingClientRect`: a
	// model write only marks `$state` dirty, so the spacer's bound `style.height` flushes in
	// a later microtask and a DOM read here would see pre-flush layout (a ~0 delta, a silent
	// no-op). `offsetOf(anchorIndex)` is the sum of heights above the anchor, so its delta is
	// exactly the shift to cancel. The anchor index is the same block before and after, and
	// no DOM is read, so the batch's read-all-then-write split is preserved (one scrollTop
	// write after the writes, not a read interleaved with them).
	function correctAnchor(mutate: () => void): void {
		const scrollEl = deps.getScrollEl();
		const anchorIndex = model.indexAtOffset(localScrollTop());
		const before = model.offsetOf(anchorIndex);
		mutate();
		const delta = model.offsetOf(anchorIndex) - before;
		if (delta !== 0 && scrollEl) scrollEl.scrollTop += delta;
	}

	// Rebuild on structural child-count change (O(n) cheap raw reads) or an editor WIDTH
	// change (prose re-wraps, so every measured height the oracle cached is stale —
	// `widthVersion` is bumped after `invalidateWidth` clears that cache, so the rebuild
	// reseeds from new-width estimates). Never per keystroke. Subscribe to count + scroll-el
	// + widthVersion only; build inside untrack so the effect doesn't subscribe to every
	// child's raw via the oracle. The rebuild reseeds EVERY slot, a wholesale offset shift
	// the flush-pass correction can't see (its before-snapshot is captured after this ran),
	// so anchor-correct the reseed itself to keep the viewport stable through a resize reflow.
	$effect(() => {
		void deps.getChildren().length;
		void deps.getScrollEl();
		void deps.getWidthVersion();
		untrack(() => {
			correctAnchor(() => {
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
	// trigger the spec requires (no microtask/rAF/timeout). It drains `pending` into one
	// read-all-then-write batch so a fling costs one reflow, not one per mounted block.
	//
	// It tracks the WINDOW only. The window changes exactly once when the mounted set
	// slides (scroll) or when a measurement grows the model — a coalesced signal that
	// already exists. Registration does NOT bump reactive state: the mount that registers
	// a child already moved the window, so a per-child trigger would re-enter this effect
	// O(children) times in one flush and trip Svelte's update-depth guard. Convergence is
	// the same as a per-block measure: `recordMeasuredChild` only bumps `heightVersion`
	// (which feeds the window) when the height actually changed, so once heights settle
	// the window stops moving and the batch finds nothing pending.
	$effect(() => {
		void win.result;
		untrack(() => flushMeasurements());
	});

	// Re-measure currently-mounted children after a WIDTH change. The width rebuild
	// above reseeds every slot from the new-width ESTIMATE, but mounted blocks have real
	// (old-width) heights that no longer match how they wrap now. Their measure effects
	// key on `node.raw`, not width, so they won't re-fire on resize — re-enroll every
	// registered (mounted) id and drain immediately. Draining here (not just leaving it
	// for the window-tracking batch effect) makes the re-measure deterministic on the
	// resize frame regardless of effect order; the batch effect's own run then finds
	// nothing pending. The first run (widthVersion 0) finds an empty registry → no-op.
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
		// An edit changes one block's height without sliding the window. Measure it
		// directly — one block is not the thrash path, and going through the same
		// convergence-guarded write (`recordMeasuredChild` no-ops once the height
		// settles) is what stops a re-measure from spinning the reactive graph.
		measureChildNow(id) {
			const child = registry.get(id);
			if (!child) return;
			const h = child.readHeight();
			if (h > 0) child.applyHeight(h);
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
		dispose() {
			win.dispose();
		}
	};
}
