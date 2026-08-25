/**
 * Editor-root ambient listeners: the mod-active cursor tracker, the selectionchange
 * bridge, and the viewport-height watcher. Pure dispatch over live getters; each
 * installing `$effect` stays in `Editor.svelte` as a guard plus one install call,
 * returning the teardown. `onRoot`/`removeAll` capture that add/remove pair once.
 */

import { tick } from 'svelte';
import type { UserScrollport } from '../cursor/scroll-ancestors';

// ── Listener plumbing ───────────────────────────────────────────────

// Typed off `Event`, not the per-target event maps: those names are type-only,
// and `target` ranges over every EventTarget the root effects listen on.
export function onRoot<E extends Event>(
	target: EventTarget,
	type: string,
	handler: (event: E) => void,
	options?: { capture?: boolean; passive?: boolean }
): () => void {
	const listener = handler as (event: Event) => void;
	target.addEventListener(type, listener, options);
	// Removal matches on capture alone: `passive` is an add-time hint the remove
	// signature rejects.
	return () => target.removeEventListener(type, listener, options?.capture);
}

export function removeAll(...removers: (() => void)[]): () => void {
	return () => removers.forEach((remove) => remove());
}

// ── Install bundles ─────────────────────────────────────────────────

/**
 * Only Ctrl/Cmd+click activates a link, so CSS switches links to a pointer cursor
 * off `data-mod-active`. Reset on blur and visibility loss, or a modifier released
 * while the page is unfocused sticks the cursor on.
 */
export function installModActiveTracker(root: HTMLElement): () => void {
	// Track the last reflected state so ordinary typing never touches the DOM,
	// keeping the attribute write off the keystroke hot path (perf:check).
	let active = false;
	const apply = (next: boolean) => {
		if (next === active) return;
		active = next;
		if (next) root.setAttribute('data-mod-active', '');
		else root.removeAttribute('data-mod-active');
	};
	const onKey = (e: KeyboardEvent) => apply(e.ctrlKey || e.metaKey);
	const reset = () => apply(false);
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') apply(false);
	};
	return removeAll(
		onRoot(document, 'keydown', onKey),
		onRoot(document, 'keyup', onKey),
		onRoot(window, 'blur', reset),
		onRoot(document, 'visibilitychange', onVisibility)
	);
}

export interface SelectionChangeBridgeDeps {
	/** The element the installing effect captured, not a live binding. */
	root: HTMLElement;
	/** Live predicate, never a capture: the header slot can mount after install. */
	isHostChrome(node: Node | null): boolean;
	/** Emits this editor's current selection snapshot, read at event time. */
	emit(): void;
}

/**
 * Single-block caret motion never goes through SelectionState, so without this
 * bridge subscribers miss every intra-block move. Scoped to `root` to avoid noise
 * from selections elsewhere on the page.
 */
export function installSelectionChangeBridge(deps: SelectionChangeBridgeDeps): () => void {
	const handler = () => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const anchorNode = sel.anchorNode;
		if (!anchorNode || !deps.root.contains(anchorNode)) return;
		// A selection in host chrome is not a document selection: emitting there
		// reports this editor's own unchanged selection on every header caret move.
		if (deps.isHostChrome(anchorNode)) return;
		deps.emit();
	};
	return onRoot(document, 'selectionchange', handler);
}

/**
 * A focus departure is a selection change no browser channel reports: the native range can
 * survive unfocused while the editor's own read goes null, so the channel announces it. Judged
 * after the flush, never at focusout: a structural commit unmounts the focused surface and
 * lands focus again after its own tick, and a departure that came back is no departure.
 */
export function installEditorBlurAnnouncer(deps: {
	root: HTMLElement;
	emit: () => void;
}): () => void {
	let pending = false;
	const handler = (event: FocusEvent) => {
		const to = event.relatedTarget;
		if ((to instanceof Node && deps.root.contains(to)) || pending) return;
		pending = true;
		void tick().then(() => {
			pending = false;
			const active = document.activeElement;
			if (active instanceof Node && deps.root.contains(active)) return;
			deps.emit();
		});
	};
	return onRoot(deps.root, 'focusout', handler);
}

/** Calls `bump` on a height change of the resolved scrollport `target`. */
export function installViewportHeightWatcher(target: UserScrollport, bump: () => void): () => void {
	if (target === window) {
		// The page viewport has no box to observe, and a visualViewport move (a mobile URL
		// bar retracting) never touches documentElement's height — hence both, ungated.
		const visual = window.visualViewport;
		return removeAll(
			onRoot(window, 'resize', bump),
			visual ? onRoot(visual, 'resize', bump) : () => {}
		);
	}
	// Cast, not a narrowing: `UserScrollport` is a union of object types, which `=== window`
	// does not narrow — the same cast `createScrollport` makes on the same split.
	const el = target as HTMLElement;
	let lastHeight = el.clientHeight;
	const observer = new ResizeObserver(() => {
		if (el.clientHeight === lastHeight) return;
		lastHeight = el.clientHeight;
		bump();
	});
	observer.observe(el);
	return () => observer.disconnect();
}
