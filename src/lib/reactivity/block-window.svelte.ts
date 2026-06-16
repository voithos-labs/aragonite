/**
 * Window math for virtual rendering. `computeWindow` is pure: given a height
 * model and the scroll viewport, it returns the [start, end) slice to mount,
 * the spacer heights that preserve native scroll geometry, the pinned-index
 * carry, and the next activation state (with hysteresis so a list at the
 * threshold doesn't thrash). The reactive `createBlockWindow` wrapper wires
 * live getters + a scroll listener to this.
 */
import { untrack } from 'svelte';
import type { HeightModel } from '../cursor/height-model';

export interface WindowInputs {
	scrollTop: number; // editor scrollTop mapped into this list's coordinate range
	viewportHeight: number;
	overscan: number; // blocks to mount above and below the visible range
	pinnedIndex: number | null; // focused/caret block to keep mounted
	active: boolean; // current activation (for hysteresis)
	activateAbovePx: number; // high watermark — activate when total exceeds it
	deactivateBelowPx: number; // low watermark — deactivate when total drops below it
}

export interface WindowResult {
	active: boolean;
	start: number; // inclusive
	end: number; // exclusive
	topSpacerPx: number;
	bottomSpacerPx: number;
	pinnedIndex: number | null;
	pinnedOutside: boolean; // pin sits outside [start, end) -> absolutely-positioned render
	pinnedOffsetPx: number | null; // pixel offset of the pin when outside the window; null otherwise
}

export function computeWindow(model: HeightModel, input: WindowInputs): WindowResult {
	const n = model.size;
	const total = model.total();

	// Hysteresis: cross the high watermark to turn on, fall below the low one to turn off.
	const active = input.active ? total >= input.deactivateBelowPx : total >= input.activateAbovePx;

	if (!active || n === 0) {
		return {
			active: false,
			start: 0,
			end: n,
			topSpacerPx: 0,
			bottomSpacerPx: 0,
			pinnedIndex: input.pinnedIndex,
			pinnedOutside: false,
			pinnedOffsetPx: null
		};
	}

	const firstVisible = model.indexAtOffset(input.scrollTop);
	// Viewport bottom edge is half-open: the block whose top sits exactly at it shows
	// zero pixels, so probe one pixel inside to avoid mounting an off-screen block.
	const lastVisible = model.indexAtOffset(input.scrollTop + input.viewportHeight - 1);
	const start = Math.max(0, firstVisible - input.overscan);
	const end = Math.min(n, lastVisible + 1 + input.overscan);

	const pinnedOutside =
		input.pinnedIndex !== null && (input.pinnedIndex < start || input.pinnedIndex >= end);

	return {
		active: true,
		start,
		end,
		topSpacerPx: model.offsetOf(start),
		bottomSpacerPx: total - model.offsetOf(end),
		pinnedIndex: input.pinnedIndex,
		pinnedOutside,
		pinnedOffsetPx: pinnedOutside ? model.offsetOf(input.pinnedIndex as number) : null
	};
}

export interface BlockWindowDeps {
	getModel: () => HeightModel;
	getScrollEl: () => HTMLElement | null;
	/** Map the scroll element's scrollTop into this list's own coordinate range. Identity for the top level. */
	getLocalScrollTop: () => number;
	getViewportHeight: () => number;
	getPinnedIndex: () => number | null;
	overscan: number;
	activateAbovePx: number;
	deactivateBelowPx: number;
}

export interface BlockWindow {
	readonly result: WindowResult;
	/** Anchor-correct around a model mutation: capture anchor top, run mutate, restore scrollTop by the delta. */
	withAnchorCorrection(anchorIndex: number, mutate: () => void): void;
	dispose(): void;
}

export function createBlockWindow(deps: BlockWindowDeps): BlockWindow {
	let active = $state(false);
	let scrollTop = $state(0);

	const onScroll = () => {
		scrollTop = deps.getLocalScrollTop();
	};

	$effect(() => {
		const el = deps.getScrollEl();
		if (!el) return;
		scrollTop = deps.getLocalScrollTop();
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	});

	const result = $derived.by(() => {
		return computeWindow(deps.getModel(), {
			scrollTop,
			viewportHeight: deps.getViewportHeight(),
			overscan: deps.overscan,
			pinnedIndex: deps.getPinnedIndex(),
			active,
			activateAbovePx: deps.activateAbovePx,
			deactivateBelowPx: deps.deactivateBelowPx
		});
	});

	// Track activation across recomputes (hysteresis state lives here).
	// `result` reads `active` and this effect writes it — write inside `untrack`
	// and only on a real change so the effect doesn't register `active` as its
	// own dependency and re-fire on its own write. It converges: once `active`
	// equals `result.active`, the guard writes nothing.
	$effect(() => {
		const next = result.active;
		untrack(() => {
			if (active !== next) active = next;
		});
	});

	return {
		get result() {
			return result;
		},
		withAnchorCorrection(anchorIndex, mutate) {
			const el = deps.getScrollEl();
			const model = deps.getModel();
			const before = model.offsetOf(anchorIndex);
			mutate();
			const after = deps.getModel().offsetOf(anchorIndex);
			if (el) el.scrollTop += after - before;
		},
		dispose() {
			const el = deps.getScrollEl();
			if (el) el.removeEventListener('scroll', onScroll);
		}
	};
}
