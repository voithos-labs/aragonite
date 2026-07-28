/**
 * Window math for virtual rendering. `computeWindow` is pure: given a height
 * model and the scroll viewport, it returns the [start, end) slice to mount —
 * extended to keep a pinned caret block contiguous — the spacer heights that
 * preserve native scroll geometry, and the next activation state (with
 * hysteresis so a list at the threshold doesn't thrash). The reactive
 * `createBlockWindow` wrapper wires live getters + a scroll listener to this.
 */
import { untrack } from 'svelte';
import type { HeightModel } from '../cursor/height-model';

export interface WindowInputs {
	scrollTop: number; // editor scrollTop mapped into this list's coordinate range
	viewportHeight: number;
	overscan: number; // blocks to mount above and below the visible range
	pinnedIndex: number | null; // focused/caret block to keep mounted
	pinExtensionCap: number; // max blocks to extend the range by to keep the pin mounted
	windowingEnabled: boolean; // false in host-scroll mode — no scrollport, so never activate
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
}

export function computeWindow(model: HeightModel, input: WindowInputs): WindowResult {
	const n = model.size;
	const total = model.total();

	// Hysteresis: cross the high watermark to turn on, fall below the low one to turn off.
	// The one activation decision in the feature — host-scroll mode reaches the
	// never-active result through this gate rather than substituting a window of its
	// own, so `active` can never disagree with what the consumer renders.
	const active =
		input.windowingEnabled &&
		(input.active ? total >= input.deactivateBelowPx : total >= input.activateAbovePx);

	if (!active || n === 0) {
		return { active: false, start: 0, end: n, topSpacerPx: 0, bottomSpacerPx: 0 };
	}

	const firstVisible = model.indexAtOffset(input.scrollTop);
	// The viewport is half-open [scrollTop, scrollTop+viewportHeight); probe the
	// last on-screen pixel so a block whose top sits exactly on the bottom edge
	// isn't counted visible.
	const lastVisible = model.indexAtOffset(input.scrollTop + input.viewportHeight - 1);
	let start = Math.max(0, firstVisible - input.overscan);
	let end = Math.min(n, lastVisible + 1 + input.overscan);

	// Keep the focused/caret block mounted by extending the CONTIGUOUS range to
	// include it (so Svelte preserves its DOM node and native focus/IME survive a
	// scroll) — but only within a bounded distance, so a caret parked far away
	// before a large scroll doesn't mount thousands. Beyond the cap it blurs (rare).
	const pin = input.pinnedIndex;
	if (pin !== null && pin >= 0 && pin < n) {
		if (pin < start && start - pin <= input.pinExtensionCap) start = pin;
		else if (pin >= end && pin + 1 - end <= input.pinExtensionCap) end = pin + 1;
	}

	return {
		active: true,
		start,
		end,
		topSpacerPx: model.offsetOf(start),
		bottomSpacerPx: total - model.offsetOf(end)
	};
}

export interface BlockWindowDeps {
	getModel: () => HeightModel;
	getScrollEl: () => HTMLElement | null;
	/** Map the scroll element's scrollTop into this list's own coordinate range. Identity for the top level. */
	getLocalScrollTop: () => number;
	getViewportHeight: () => number;
	getPinnedIndex: () => number | null;
	/** Static read (host-scroll is set once at mount): reading a live prop here would
	 *  make it a dependency of the window derived, the editor's hottest path. */
	windowingEnabled: () => boolean;
	overscan: number;
	pinExtensionCap: number;
	activateAbovePx: number;
	deactivateBelowPx: number;
}

export interface BlockWindow {
	readonly result: WindowResult;
	/** Push the scroll element's current scrollTop into the window state now. A
	 *  programmatic scrollTop write doesn't fire a `scroll` event, so the passive
	 *  listener wouldn't update the derived in time for a deterministic reveal. */
	syncScrollTop(): void;
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
			pinExtensionCap: deps.pinExtensionCap,
			windowingEnabled: deps.windowingEnabled(),
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
		syncScrollTop() {
			scrollTop = deps.getLocalScrollTop();
		},
		dispose() {
			const el = deps.getScrollEl();
			if (el) el.removeEventListener('scroll', onScroll);
		}
	};
}
