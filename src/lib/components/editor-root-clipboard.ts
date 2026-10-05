/**
 * Editor-root clipboard routing: copy, cut and paste for an event that reached no block. A
 * selection whose block holds no text position leaves the native selection empty, so Chromium
 * dispatches at `document.body`, where no per-block listener sees it. The reading-mode checks
 * live in the handlers each route calls into, not here.
 */

import { claimsBodyChord } from '../active-editor';
import type { BlockComponent } from '../block-component';
import type { DocumentGetter, PasteImageHook } from '../editor-keys';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';
import { emitClipboardError, type EditorEvents } from '../editor-events';
import { createImagePasteArm } from './paste-image-arm';
import { runClipboardCut, takeCopy } from './blocks/clipboard-step';
import { crossBlockClipboardArm } from '../selection/cross-block/clipboard';

export interface EditorRootClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Required but nullable, so this route cannot silently skip the image handling the
	 *  blocks do; `undefined` means no hook. */
	onPasteImage: PasteImageHook | undefined;
	events: EditorEvents;
	/** The mounted block at `path`, which takes a selected widget's clipboard events. */
	getBlockComponent(path: number[]): BlockComponent | null;
}

export interface EditorRootClipboard {
	/** `root` is the element the installing effect captured, not a live binding. */
	handleCopy(event: ClipboardEvent, root: HTMLElement): void;
	handleCut(event: ClipboardEvent, root: HTMLElement): void;
	handlePaste(event: ClipboardEvent, root: HTMLElement): void;
}

/** The two states whose events land here, in the order they are tried. */
type RootClipboardTarget = { arm: 'widget'; block: BlockComponent } | { arm: 'cross-block' };

export function createEditorRootClipboard(deps: EditorRootClipboardDeps): EditorRootClipboard {
	const crossBlockArms = [
		crossBlockClipboardArm({
			selection: deps.selection,
			getDoc: deps.getDoc,
			crossBlock: deps.crossBlock
		})
	];
	const imageArm = createImagePasteArm({
		onPasteImage: deps.onPasteImage,
		events: deps.events,
		crossBlock: deps.crossBlock
	});

	/** On this root, or on the body with this instance holding the chord; the search input and a
	 *  header field sit inside the root and keep their own clipboard. */
	function landedNowhere(root: HTMLElement, target: EventTarget | null): boolean {
		if (target === root) return true;
		return (target === null || target === root.ownerDocument.body) && claimsBodyChord(root);
	}

	/** A block marks an event it handled with `defaultPrevented`. The selection state holds a
	 *  widget or a range, never both, so their order does not matter. */
	function targetOf(event: ClipboardEvent, root: HTMLElement): RootClipboardTarget | null {
		if (event.defaultPrevented) return null;
		if (!landedNowhere(root, event.target)) return null;
		const widget = deps.selection.widget;
		const block = widget && deps.getBlockComponent(widget.paragraphPath);
		if (block) return { arm: 'widget', block };
		return deps.selection.isCrossBlock ? { arm: 'cross-block' } : null;
	}

	return {
		handleCopy(event, root) {
			const target = targetOf(event, root);
			if (!target) return;
			if (target.arm === 'widget') target.block.claimRootClipboard?.(event);
			else if (takeCopy(event, crossBlockArms)) event.preventDefault();
		},
		handleCut(event, root) {
			const target = targetOf(event, root);
			if (!target) return;
			if (target.arm === 'widget') target.block.claimRootClipboard?.(event);
			else void runClipboardCut(event, crossBlockArms);
		},
		handlePaste(event, root) {
			const target = targetOf(event, root);
			if (!target) return;
			if (target.arm === 'widget') target.block.claimRootClipboard?.(event);
			else void paste(event);
		}
	};

	/** Images first, as a block does: an image-only paste has no `text/plain` for the
	 *  cross-block branch to use. */
	async function paste(event: ClipboardEvent): Promise<void> {
		// Read the range synchronously with the event, while the cross-block handling still
		// guarantees a selection: below the await, a read could only report nothing.
		const rangeStartPath = deps.selection.start?.path.slice();
		const images = imageArm.filesOf(event.clipboardData);
		if (images.length === 0) {
			await deps.crossBlock.handlePaste(event);
			return;
		}
		// Prevent before awaiting the hook, as a block does: the browser's own paste would
		// otherwise fire during the import and inject DOM the CST never sees.
		event.preventDefault();
		const markdown = await imageArm.run(event, images);
		if (markdown === null) return;
		// The selection collapsed mid-import, leaving an imported asset and no caret: the one
		// thing this route cannot supply, having no block to fall back on.
		emitClipboardError(deps.events, {
			error: new Error(
				'imported image had no insertion point at the editor root; nothing inserted'
			),
			...(rangeStartPath ? { path: rangeStartPath } : {})
		});
	}
}
