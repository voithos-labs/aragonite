/**
 * Editor-root clipboard routing: copy, cut and paste for a range across blocks or a selected widget
 * that no block handled. Where the selection's end holds no text position, Chromium dispatches at
 * `document.body` and Firefox at whatever block element holds it. The reading-mode checks live in
 * the handlers each route calls into, not here.
 */

import { claimsBodyChord, isTextEntrySurface } from '../../active-editor';
import type { BlockComponent } from '../../block-component';
import type { DocumentGetter } from '../../editor-keys';
import type { PasteImageHook } from '../../host-hooks';
import type { SelectionState } from '../../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../../selection/cross-block/dispatch';
import { emitClipboardError, type EditorEvents } from '../../editor-events';
import { createImagePasteArm } from '../paste-image-arm';
import { runClipboardCut, takeCopy } from '../blocks/editable/clipboard-step';
import { crossBlockClipboardArm } from '../../selection/cross-block/clipboard';
import { isWholeBlockInputProxy } from '../../selection/whole-block-input';

export interface EditorRootClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Required, so this route cannot silently skip the image handling the blocks do. */
	onPasteImage: () => PasteImageHook | undefined;
	events: EditorEvents;
	/** The mounted block at `path`, which takes a selected widget's clipboard events. */
	getBlockComponent(path: number[]): BlockComponent | null;
	/** Whether `node` is in the host's header, whose fields keep their own clipboard. */
	isHostChrome(node: Node | null): boolean;
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

	/** Inside this root, or on the body with this instance holding the chord; a text field other
	 *  than a block's whole-block input, and the host's header, keep their own clipboard. */
	function aimedAtRoot(root: HTMLElement, target: EventTarget | null): boolean {
		if (target === null || target === root.ownerDocument.body) return claimsBodyChord(root);
		if (!(target instanceof Node) || !root.contains(target)) return false;
		if (target instanceof Element && isTextEntrySurface(target) && !isWholeBlockInputProxy(target))
			return false;
		return !deps.isHostChrome(target);
	}

	/** A block marks an event it handled with `defaultPrevented`. The selection state holds a
	 *  widget or a range, never both, so their order does not matter. */
	function targetOf(event: ClipboardEvent, root: HTMLElement): RootClipboardTarget | null {
		if (event.defaultPrevented) return null;
		if (!aimedAtRoot(root, event.target)) return null;
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
