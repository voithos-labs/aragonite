/**
 * Editor-root ambient listeners: the mod-active cursor tracker, the selectionchange
 * bridge, the blur announcer and the double-click word select. Pure dispatch over live
 * getters; each installing `$effect` stays in `Editor.svelte` as a guard plus one install
 * call, returning the teardown. `onRoot`/`removeAll` capture that add/remove pair once.
 */

import { tick } from 'svelte';
import { isEditableEventTarget } from '../editor-actions/whole-block-focus-surface';
import { selectWordAtPoint, trimDoubleClickSelection } from '../selection/double-click-trim';

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

/**
 * Windows Chromium's double-click takes the space after the word, so the word is selected on
 * the SECOND press, trimmed, with the native selection suppressed; the dblclick trim is the
 * fallback. A press on an inline widget is that widget's own gesture (a footnote's double-click
 * takes its whole token), so the root leaves it to the widget.
 */
export function installDoubleClickWordSelect(root: HTMLElement): () => void {
	const onSecondPress = (e: MouseEvent) => {
		if (e.detail !== 2 || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
		if (!isEditableEventTarget(e.target) || pressesInlineWidget(e.target)) return;
		if (selectWordAtPoint(root.ownerDocument, e.clientX, e.clientY)) e.preventDefault();
	};
	return removeAll(
		onRoot(root, 'mousedown', onSecondPress),
		onRoot(root, 'dblclick', () => trimDoubleClickSelection(root.ownerDocument))
	);
}

function pressesInlineWidget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest('[data-inline-widget]') !== null;
}
