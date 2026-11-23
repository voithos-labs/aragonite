/**
 * Tracks which block host holds the caret. Each windowing list keeps that block mounted, so a
 * scroll that pushes the caret off-screen never drops native focus or the IME. The preview modes
 * style the focused block's markers off `data-focused`, and live mode a `:::` opener line's; the
 * attribute moves only while no pointer is down.
 */

import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkCaretCanLand } from '../../invariants/caret-can-land';
import { isPreviewMode, type PresentationMode } from '../../presentation-mode';
import { readBlockPath } from '../../selection/path-lookup';
import { CONTENT_EMPTY_ATTR, PRESS_HELD_ATTR, SOURCE_AT_CARET_ATTR } from '../../browser/painted';
import { onRoot, removeAll } from './listeners';
import type { TextMoves } from '../overlays/text-moves';

export interface FocusAttributionDeps {
	/** A getter, never a value: every attribute write is gated on the mode in force. */
	get mode(): PresentationMode;
	/** Told whenever focus shows or hides a block's markers, since that moves its text. */
	textMoves: Pick<TextMoves, 'movedWithin'>;
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
	let editorRoot: HTMLElement | null = null;
	let pressHeld = false;
	// Whether focus sits on a row that shows its source at the caret, which live mode marks too.
	let onSourceRow = false;
	let readAttr: string | null = null;
	let readPath: number[] | null = null;

	// Never in source or reading, whose DOM stays byte-identical; a held press keeps the prior
	// paint so markers can't move the text the caret is about to land in.
	function applyFocusedAttr(): void {
		if (pressHeld) return;
		const marks = isPreviewMode(deps.mode) || (deps.mode === 'live' && onSourceRow);
		const next = marks ? focusedHostEl : null;
		if (paintedHostEl !== next) {
			paintedHostEl?.removeAttribute('data-focused');
			if (paintedHostEl) deps.textMoves.movedWithin(paintedHostEl);
			if (next) deps.textMoves.movedWithin(next);
		}
		next?.setAttribute('data-focused', '');
		paintedHostEl = next;
	}

	function setFocusedHost(host: HTMLElement | null): void {
		if (focusedHostEl === host) return;
		// A block of bare markers shows them while focused, in every mode that hides them.
		for (const el of [focusedHostEl, host]) {
			if (el?.querySelector(`[${CONTENT_EMPTY_ATTR}]`)) deps.textMoves.movedWithin(el);
		}
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

	// The root carries the press as well, so a row focused under it reads hidden in the stylesheet
	// and in `browser/painted.ts` alike; nothing repaints until the release moves the mark.
	function holdPress(held: boolean): void {
		pressHeld = held;
		const hides = isPreviewMode(deps.mode) || deps.mode === 'live';
		editorRoot?.toggleAttribute(PRESS_HELD_ATTR, held && hides);
	}

	// A release the page never hears (focus or the window left mid-press) must not strand the paint.
	function endPress(): void {
		if (!pressHeld) return;
		holdPress(false);
		applyFocusedAttr();
	}

	function install(root: HTMLElement): () => void {
		editorRoot = root;
		const onFocusIn = (e: FocusEvent) => {
			const host = (e.target as Element | null)?.closest('[data-block-path]');
			if (!host || !root.contains(host)) {
				clear();
				return;
			}
			onSourceRow = e.target instanceof Element && e.target.hasAttribute(SOURCE_AT_CARET_ATTR);
			setFocusedHost(host as HTMLElement);
			// Every way of placing a caret focuses its editable element, whoever wrote the code,
			// so a consumer's own caret placement is checked here too (G1.33).
			const landed = e.target;
			if (landed instanceof HTMLElement) {
				assertInvariant('caret-can-land', () =>
					checkCaretCanLand(landed, deps.mode, focusedPath() ?? [])
				);
			}
		};
		const onFocusOut = (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return; // moving between blocks: keep the focused path
			holdPress(false);
			clear();
		};
		const onPress = (e: MouseEvent) => {
			if (e.button === 0) holdPress(true);
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
