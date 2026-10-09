/**
 * The editor root's document and window listeners, each installed by one call that returns its
 * teardown. `onRoot` and `removeAll` keep every add paired with its remove.
 */

import { tick } from 'svelte';
import { isModifiedClick, type PressTracker } from '../activation-click';
import { findSurfacePathForElement } from '../selection/path-lookup';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { CaretWriter } from '../caret/widget-offset';
import { BARE_MODIFIER_KEYS } from '../schema/keybindings';

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

/** Ctrl/Cmd+click follows a link in every mode, so CSS shows the pointer off `data-mod-active`;
 *  reset on blur and visibility loss, so a key released while unfocused cannot stick it. */
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
	// The held keys are what the next click would carry.
	const onKey = (e: KeyboardEvent) => apply(isModifiedClick(e));
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

/** Records every primary press in `root`, in the capture phase so a block that cancels its press
 *  still reports it. */
export function installPressTracker(root: HTMLElement, presses: PressTracker): () => void {
	return onRoot<PointerEvent>(
		root,
		'pointerdown',
		(e) => {
			if (e.button === 0) presses.press(e);
		},
		{ capture: true }
	);
}

/** The user's input in `root` ends the open undo step, so typing while a plugin's commit waits
 *  gets its own entry; window capture ends it before the root's handlers open the next. */
export function installUndoStepEnd(root: HTMLElement, endStep: () => void): () => void {
	const win = root.ownerDocument.defaultView;
	if (!win) return () => {};
	const handler = (e: Event) => {
		if (!(e.target instanceof Node) || !root.contains(e.target)) return;
		// A held Shift or Ctrl is not input yet; the key it modifies is.
		if (e instanceof KeyboardEvent && BARE_MODIFIER_KEYS.includes(e.key)) return;
		endStep();
	};
	const removers = ['keydown', 'beforeinput', 'paste', 'cut', 'drop'].map((type) =>
		onRoot(win, type, handler, { capture: true })
	);
	return () => removers.forEach((remove) => remove());
}

/** A block stays held in place until the user's next gesture on the scroll container; not
 *  `scroll`, which a programmatic correction fires too. */
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
	/** Read for an inline widget selected whole, which owns the keys while it is. */
	selection: Pick<SelectionState, 'widget'>;
	caretWriter: CaretWriter;
}

/** Announces caret motion the editor did not make (a click, a move within one block), and drops
 *  a caret that appears while an inline widget is selected whole. */
export function installSelectionChangeBridge(deps: SelectionChangeBridgeDeps): () => void {
	const handler = () => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const anchorNode = sel.anchorNode;
		if (!anchorNode || !deps.root.contains(anchorNode)) return;
		// A selection in the host's header is not a document selection: announcing there
		// reports this editor's own unchanged selection on every header caret move.
		if (deps.isHostChrome(anchorNode)) return;
		// The paragraph keeps focus while its widget is selected, and the browser puts a caret at
		// its start on any mouse input. A drag's range and a caret in a popover field stay.
		if (sel.isCollapsed && deps.selection.widget !== null && inBlockSurface(anchorNode)) {
			deps.caretWriter.clear();
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

function inBlockSurface(node: Node): boolean {
	const el = node instanceof Element ? node : node.parentElement;
	return findSurfacePathForElement(el) !== null;
}

/** Announces losing focus, a selection change no browser event reports; decided after the
 *  flush, since a structural commit refocuses its block a tick later. */
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
