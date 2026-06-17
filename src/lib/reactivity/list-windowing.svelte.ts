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

export interface ListWindowing {
	readonly window: WindowResult;
	/** A DIRECTLY-MEASURED leaf: oracle (by id) + model slot. Passive — no scrollTop write. */
	recordMeasuredChild(index: number, id: string, height: number): void;
	/** A PROPAGATED child-container subtotal: model slot ONLY, by index. No oracle, no id, no anchor. */
	setChildSubtotal(index: number, total: number): void;
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

	// Rebuild on structural child-count change (O(n) cheap raw reads); never per
	// keystroke. Subscribe to count + scroll-el only; build inside untrack so the
	// effect doesn't subscribe to every child's raw via the oracle.
	$effect(() => {
		void deps.getChildren().length;
		void deps.getScrollEl();
		untrack(() => {
			model = buildModel();
			heightVersion++;
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
