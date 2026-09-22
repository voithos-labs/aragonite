/**
 * Editor-root document listeners: the mod-active cursor tracker, the reveal-anchor release,
 * the selectionchange bridge and the blur announcer. Pure dispatch over live getters; each
 * installing `$effect` stays in `Editor.svelte` as a check plus one install call, returning
 * the teardown. `onRoot` and `removeAll` hold the add/remove pair in one place.
 */

import { tick } from 'svelte';

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

/**
 * A block stays held in place only until the user's next gesture on the resolved scroll
 * container. Not `scroll`: a programmatic correction fires that too, and would release the
 * hold half way through.
 */
export function installRevealAnchorRelease(port: EventTarget, release: () => void): () => void {
	return removeAll(
		onRoot(port, 'keydown', release),
		onRoot(port, 'pointerdown', release),
		onRoot(port, 'wheel', release, { passive: true })
	);
}

export interface SelectionChangeBridgeDeps {
	/** The element the installing effect captured, not a live binding. */
	root: HTMLElement;
	/** A live check, never captured: the host's header can mount after install. */
	isHostChrome(node: Node | null): boolean;
	/** Announces this editor's current selection, and does nothing when it is the one
	 *  subscribers were already told about. */
	announceIfMoved(): void;
	/** Whether an inline widget is selected whole, which owns the keys while it is. */
	isWidgetSelected(): boolean;
}

/**
 * Caret motion the editor did not perform itself: a click, and single-block moves, which never
 * go through SelectionState. Scoped to `root`, silent about a position already announced, and
 * it drops a caret that appears while an inline widget is selected whole.
 */
export function installSelectionChangeBridge(deps: SelectionChangeBridgeDeps): () => void {
	const handler = () => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const anchorNode = sel.anchorNode;
		if (!anchorNode || !deps.root.contains(anchorNode)) return;
		// A selection in the host's header is not a document selection: announcing there
		// reports this editor's own unchanged selection on every header caret move.
		if (deps.isHostChrome(anchorNode)) return;
		// The paragraph keeps focus while its widget is selected, and the browser seats a caret at
		// its start on any mouse input; a drag's range is the user's own and stays.
		if (sel.isCollapsed && deps.isWidgetSelected()) {
			sel.removeAllRanges();
			return;
		}
		deps.announceIfMoved();
	};
	return removeAll(
		onRoot(document, 'selectionchange', handler),
		// The browser reports a click's caret on a later task, which a byte typed straight after
		// beats. On `document` so the block's own click handling refines the caret first.
		onRoot(document, 'click', handler)
	);
}

/**
 * Losing focus is a selection change no browser event reports: the native range can survive
 * unfocused while the editor's own read goes null, so this announces it. Decided after the
 * flush, never at focusout: a structural commit unmounts the focused block and puts focus back
 * after its own tick, and focus that came back never left.
 */
export function installEditorBlurAnnouncer(deps: {
	root: HTMLElement;
	announce: () => void;
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
			deps.announce();
		});
	};
	return onRoot(deps.root, 'focusout', handler);
}
