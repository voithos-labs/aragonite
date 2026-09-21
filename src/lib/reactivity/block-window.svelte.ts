/**
 * Window math for virtual rendering. `computeWindow` is pure: from a height table and the
 * scroll viewport it returns the range of blocks to mount (extended so the caret's block stays
 * inside it), the spacer heights that preserve the browser's scroll geometry, and whether
 * windowing is on. `createBlockWindow` wires live getters and a scroll listener to it.
 */
import { untrack } from 'svelte';
import type { HeightModel } from '../cursor/height-model';
import type { Scrollport } from '../cursor/scrollport';

export interface WindowInputs {
	scrollTop: number; // the scroll container's scrollTop, in this list's coordinates
	viewportHeight: number;
	overscan: number; // blocks to mount above and below the visible range
	pinnedIndex: number | null; // focused/caret block to keep mounted
	pinExtensionCap: number; // most blocks the range may grow by to keep that one mounted
	active: boolean; // whether windowing is on now (for hysteresis)
	activateAbovePx: number; // turn windowing on when the total exceeds this
	deactivateBelowPx: number; // turn windowing off when the total drops below this
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

	// The one place windowing turns on or off: a list decides purely on its own estimated
	// height, so who owns the scroll changes which container is read and nothing else.
	const active = input.active ? total >= input.deactivateBelowPx : total >= input.activateAbovePx;

	if (!active || n === 0) {
		return { active: false, start: 0, end: n, topSpacerPx: 0, bottomSpacerPx: 0 };
	}

	const firstVisible = model.indexAtOffset(input.scrollTop);
	// Check the last on-screen pixel: the viewport range is half-open, so a block whose top
	// sits exactly on the bottom edge isn't visible.
	const lastVisible = model.indexAtOffset(input.scrollTop + input.viewportHeight - 1);
	let start = Math.max(0, firstVisible - input.overscan);
	let end = Math.min(n, lastVisible + 1 + input.overscan);

	// Extend the range, which stays contiguous, so Svelte keeps the caret block's DOM node and
	// the browser's focus and IME survive a scroll. Bounded, so a caret left far away before a
	// large scroll doesn't mount thousands of blocks; past the cap it loses focus.
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
	getPort: () => Scrollport | null;
	/** Convert the scroll container's `scrollTop` into this list's own range. Unchanged at the
	 *  top level. */
	getLocalScrollTop: () => number;
	getViewportHeight: () => number;
	getPinnedIndex: () => number | null;
	overscan: number;
	pinExtensionCap: number;
	activateAbovePx: number;
	deactivateBelowPx: number;
}

export interface BlockWindow {
	readonly result: WindowResult;
	/** Push the scroll element's current `scrollTop` into the window state now. A scripted
	 *  `scrollTop` write fires no `scroll` event, so the passive listener would not update the
	 *  `$derived` in time for a scroll into view to be deterministic. */
	syncScrollTop(): void;
	dispose(): void;
}

export function createBlockWindow(deps: BlockWindowDeps): BlockWindow {
	let active = $state(false);
	let scrollTop = $state(0);
	let unsubscribe: (() => void) | null = null;

	const onScroll = () => {
		scrollTop = deps.getLocalScrollTop();
	};

	$effect(() => {
		const port = deps.getPort();
		if (!port) return;
		scrollTop = deps.getLocalScrollTop();
		unsubscribe = port.subscribe(onScroll);
		return () => {
			unsubscribe?.();
			unsubscribe = null;
		};
	});

	const result = $derived.by(() => {
		return computeWindow(deps.getModel(), {
			scrollTop,
			viewportHeight: deps.getViewportHeight(),
			overscan: deps.overscan,
			pinnedIndex: deps.getPinnedIndex(),
			pinExtensionCap: deps.pinExtensionCap,
			active,
			activateAbovePx: deps.activateAbovePx,
			deactivateBelowPx: deps.deactivateBelowPx
		});
	});

	// Hysteresis state. `result` reads `active` and this effect writes it, so the write is
	// untracked and only happens on a change; otherwise the effect would depend on its own
	// write. It settles: once `active` equals `result.active` nothing is written.
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
			unsubscribe?.();
			unsubscribe = null;
		}
	};
}
