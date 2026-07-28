/**
 * Editor-root clipboard routing: the cross-block copy/cut/paste for a clipboard
 * event that reached no block surface.
 *
 * A cross-block selection is painted by overlays, and the collapsed caret the
 * selection seam parks at the focus endpoint is best-effort — an endpoint whose
 * block hosts no text position (an image-only paragraph, a thematic break) leaves
 * the native selection empty, and Chromium then dispatches `copy`/`cut`/`paste` at
 * `document.body` rather than at the focused block. The per-block bindings never see
 * it, so before this seam existed the whole gesture died silently: Ctrl+C over a
 * whole document wrote nothing at all to the system clipboard.
 *
 * Sibling of `editor-root-keydown.ts` in every respect: pure dispatch over live
 * getters, the installing `$effect` stays in `Editor.svelte`, and the root element
 * arrives per event rather than as a re-read binding. Reading-mode gates are NOT
 * repeated here — they live at the cross-block composer, which is the seam every arm
 * below calls into.
 */

import { claimsBodyChord } from '../active-editor';
import type { DocumentGetter } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';
import {
	writeCrossBlockCopy,
	writeCrossBlockCut,
	type CrossBlockClipboardDeps
} from '../selection/cross-block/clipboard';

export interface EditorRootClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
}

export interface EditorRootClipboard {
	/** `root` is the element the installing effect captured, not a live binding. */
	handleCopy(event: ClipboardEvent, root: HTMLElement): void;
	handleCut(event: ClipboardEvent, root: HTMLElement): void;
	handlePaste(event: ClipboardEvent, root: HTMLElement): void;
}

export function createEditorRootClipboard(deps: EditorRootClipboardDeps): EditorRootClipboard {
	const crossDeps: CrossBlockClipboardDeps = {
		selection: deps.selection,
		getDoc: deps.getDoc,
		crossBlock: deps.crossBlock
	};

	/**
	 * The event landed nowhere: on this root itself (focus parked there after a
	 * windowed-out handoff) or on the body (the retarget above). Deliberately NOT
	 * "anywhere inside the root that isn't a block" — the search bar's input and a
	 * host's header field are both inside, own their own clipboard, and would be
	 * hijacked by the wider test. The body arm is claimant-scoped for the same
	 * reason the keydown sibling's is: the listener sees every editor on the page.
	 */
	function landedNowhere(root: HTMLElement, target: EventTarget | null): boolean {
		if (target === root) return true;
		return (target === null || target === root.ownerDocument.body) && claimsBodyChord(root);
	}

	/**
	 * `defaultPrevented` is the block surfaces' receipt — every arm of their shared
	 * clipboard skeleton prevents before it writes. The one arm that deliberately
	 * declines to the native default (a table cell's copy at a collapsed caret)
	 * cannot collide: a collapsed cell caret is not a cross-block selection.
	 */
	function claims(event: ClipboardEvent, root: HTMLElement): boolean {
		if (event.defaultPrevented) return false;
		if (!deps.selection.isCrossBlock) return false;
		return landedNowhere(root, event.target);
	}

	return {
		handleCopy(event, root) {
			if (!claims(event, root)) return;
			writeCrossBlockCopy(event, crossDeps);
		},
		handleCut(event, root) {
			if (!claims(event, root)) return;
			void writeCrossBlockCut(event, crossDeps);
		},
		handlePaste(event, root) {
			if (!claims(event, root)) return;
			void deps.crossBlock.handlePaste(event);
		}
	};
}
