/**
 * Tracks which block host holds the caret. Each windowing list keeps that block mounted, so a
 * scroll that pushes the caret off-screen never drops native focus or the IME. The preview modes
 * style the focused block's markers off `data-focused`, which moves only while no pointer is down.
 */

import { assertInvariant } from '../assert';
import { checkLandableCaret } from '../invariants/landable-caret';
import { isPreviewMode, type PresentationMode } from '../presentation-mode';
import { readBlockPath } from '../selection/path-lookup';
import { onRoot, removeAll } from './editor-root-listeners';

export interface FocusAttributionDeps {
	/** A getter, never a value: every attribute write is gated on the mode in force. */
	get mode(): PresentationMode;
}

export interface FocusAttribution {
	/** `root` is the element the installing effect captured, not a live binding. */
	install(root: HTMLElement): () => void;
	/** Entering a preview mode marks the already-focused block, since no re-focus fires. */
	applyForMode(): void;
	/** The focused block's path as it stands now, read off its element: a keyed move that keeps
	 *  focus renumbers the block, so a path noted when focus arrived would name its old neighbour. */
	getFocusedPath(): number[] | null;
}

export function createFocusAttribution(deps: FocusAttributionDeps): FocusAttribution {
	// Plain fields, never reactive: focusout fires mid-teardown during a structural commit,
	// where a reactive write would trip state_unsafe_mutation.
	let focusedHostEl: HTMLElement | null = null;
	let paintedHostEl: HTMLElement | null = null;
	let pressHeld = false;
	let readAttr: string | null = null;
	let readPath: number[] | null = null;

	// Preview modes only, so source and reading DOM stay byte-identical; a held press keeps the prior
	// paint so markers can't move the text the caret is about to land in.
	function applyFocusedAttr(): void {
		if (pressHeld) return;
		const next = isPreviewMode(deps.mode) ? focusedHostEl : null;
		if (paintedHostEl !== next) paintedHostEl?.removeAttribute('data-focused');
		next?.setAttribute('data-focused', '');
		paintedHostEl = next;
	}

	function setFocusedHost(host: HTMLElement | null): void {
		if (focusedHostEl === host) return;
		focusedHostEl = host;
		applyFocusedAttr();
	}

	function clear(): void {
		setFocusedHost(null);
	}

	// Parsed only when the attribute changes, since windowing reads it on every height correction.
	function focusedPath(): number[] | null {
		if (!focusedHostEl?.isConnected) return null;
		const attr = focusedHostEl.getAttribute('data-block-path');
		if (attr !== readAttr) {
			readAttr = attr;
			const path = readBlockPath(focusedHostEl);
			readPath = path && path.length > 0 ? path : null;
		}
		return readPath;
	}

	// A release the page never hears (focus or the window left mid-press) must not strand the paint.
	function endPress(): void {
		if (!pressHeld) return;
		pressHeld = false;
		applyFocusedAttr();
	}

	function install(root: HTMLElement): () => void {
		const onFocusIn = (e: FocusEvent) => {
			const host = (e.target as Element | null)?.closest('[data-block-path]');
			if (!host || !root.contains(host)) {
				clear();
				return;
			}
			setFocusedHost(host as HTMLElement);
			// Every way of placing a caret focuses its editable element, whoever wrote the code,
			// so a consumer's own caret placement is checked here too (G1.33).
			const landed = e.target;
			if (landed instanceof HTMLElement) {
				assertInvariant('landable-caret', () =>
					checkLandableCaret(landed, deps.mode, focusedPath() ?? [])
				);
			}
		};
		const onFocusOut = (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return; // moving between blocks: keep the focused path
			pressHeld = false;
			clear();
		};
		const onPress = (e: MouseEvent) => {
			if (e.button === 0) pressHeld = true;
		};
		const doc = root.ownerDocument;
		return removeAll(
			onRoot(root, 'focusin', onFocusIn),
			onRoot(root, 'focusout', onFocusOut),
			onRoot(root, 'pointerdown', onPress, { capture: true }),
			onRoot(doc, 'pointerup', endPress, { capture: true }),
			// A tap focuses on the mousedown the browser sends after the finger lifts.
			onRoot(root, 'mousedown', onPress, { capture: true }),
			onRoot(doc, 'mouseup', endPress, { capture: true }),
			// A drag of the selection itself ends in pointercancel, never pointerup.
			onRoot(doc, 'pointercancel', endPress, { capture: true }),
			onRoot(doc.defaultView ?? window, 'blur', endPress)
		);
	}

	return {
		install,
		applyForMode: applyFocusedAttr,
		getFocusedPath: focusedPath
	};
}
