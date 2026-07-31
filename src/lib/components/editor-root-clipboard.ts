/**
 * Editor-root clipboard routing: cross-block copy/cut/paste for an event that reached
 * no block surface. An endpoint whose block hosts no text position leaves the native
 * selection empty, so Chromium dispatches at `document.body`, where no per-block
 * binding sees it. Sibling of `editor-root-keydown.ts`; reading-mode gates live at the
 * cross-block composer every arm calls into, not here.
 */

import { claimsBodyChord } from '../active-editor';
import type { DocumentGetter, PasteImageHook } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';
import { emitClipboardError, type EditorEvents } from '../editor-events';
import { createImagePasteArm } from './paste-image-arm';
import {
	writeCrossBlockCopy,
	writeCrossBlockCut,
	type CrossBlockClipboardDeps
} from '../selection/cross-block/clipboard';

export interface EditorRootClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Required-nullable so this seam cannot silently skip the arm the block surfaces
	 *  run; `undefined` = no hook. */
	onPasteImage: PasteImageHook | undefined;
	events: EditorEvents;
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
	const imageArm = createImagePasteArm({
		onPasteImage: deps.onPasteImage,
		events: deps.events,
		crossBlock: deps.crossBlock
	});

	/**
	 * The event landed nowhere: on this root, or on the body via the retarget above.
	 * Deliberately NOT "inside the root but not a block" — the search input and a
	 * host's header field are both inside and own their own clipboard. The body arm is
	 * claimant-scoped because the listener sees every editor on the page.
	 */
	function landedNowhere(root: HTMLElement, target: EventTarget | null): boolean {
		if (target === root) return true;
		return (target === null || target === root.ownerDocument.body) && claimsBodyChord(root);
	}

	/**
	 * `defaultPrevented` is the block surfaces' receipt: every arm of their shared
	 * clipboard skeleton prevents before it writes. The one arm that declines to the
	 * native default is a collapsed cell caret, which is never a cross-block selection.
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
			void paste(event);
		}
	};

	/**
	 * The image arm first, exactly as a block surface orders it: the root reaches this
	 * seam for a pure-image paste whenever the focus endpoint hosts no caret, and going
	 * straight to the cross-block arm discarded it for want of any `text/plain`.
	 */
	async function paste(event: ClipboardEvent): Promise<void> {
		// Read the range synchronously with the event, while `claims` still guarantees a
		// cross-block selection — below the await, a read could only report nothing.
		const rangeStartPath = deps.selection.start?.path.slice();
		const images = imageArm.filesOf(event.clipboardData);
		if (images.length === 0) {
			await deps.crossBlock.handlePaste(event);
			return;
		}
		// Prevent before awaiting the hook, as the surface skeleton does: the browser's
		// own paste would otherwise fire during the import and inject DOM the CST never sees.
		event.preventDefault();
		const markdown = await imageArm.run(event, images);
		if (markdown === null) return;
		// The selection collapsed mid-import, leaving an imported asset and no caret —
		// the one landing this seam cannot supply, having no block surface to fall back on.
		emitClipboardError(deps.events, {
			error: new Error(
				'imported image had no insertion point at the editor root; nothing inserted'
			),
			...(rangeStartPath ? { path: rangeStartPath } : {})
		});
	}
}
