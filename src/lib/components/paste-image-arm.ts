/**
 * The part of a paste that hands images to the host's import hook, shared by the blocks' own
 * clipboard code and the editor-root fallback. It ends at "here is the markdown nobody took";
 * each caller owns what happens next. Two ordering rules: files are read before the first await
 * (`clipboardData` is not reliably live afterwards), and a multi-block selection is deleted only
 * after the hook answers, so a failed import destroys nothing.
 */

import type { PasteImageHook } from '../editor-keys';
import { emitClipboardError, type EditorEvents } from '../editor-events';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';

export interface ImagePasteArmDeps {
	/** Undefined leaves a paste carrying images on the text/plain path: `filesOf`
	 *  then reports none. */
	onPasteImage: PasteImageHook | undefined;
	/** A failed import reports here rather than vanishing. */
	events: EditorEvents;
	crossBlock: CrossBlockHandlers;
}

export interface ImagePasteArm {
	/** Call before the handler's first await; empty when no hook is installed. */
	filesOf(data: DataTransfer | null): File[];
	/**
	 * Import `files` in clipboard order, then offer the markdown to the cross-block paste.
	 * Null means there is nothing left to do (nothing imported, or a multi-block selection
	 * took the insertion); markdown means no selection took it.
	 */
	run(e: ClipboardEvent, files: File[]): Promise<string | null>;
}

export function createImagePasteArm(deps: ImagePasteArmDeps): ImagePasteArm {
	return {
		filesOf: (data) => (deps.onPasteImage ? imageFilesOf(data) : []),

		async run(e, files) {
			const importImage = deps.onPasteImage;
			if (!importImage) return null;
			const markdown = await importAll(deps, importImage, files);
			// Empty markdown ends this the same way no markdown does, and keeps the
			// cross-block paste from being handed an empty string.
			if (!markdown) return null;
			// Go through the ordinary paste route rather than inserting anything here: the
			// delete collapses to the start and the receiving block may be merged away. That
			// route reads `isCrossBlock` live, so the selection as it stands is the one replaced.
			if (await deps.crossBlock.handlePaste(e, markdown)) return null;
			return markdown;
		}
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/** A paste can carry a plain attachment alongside its text; only images belong to
 *  the host hook, the rest stays on the text/plain path. */
function imageFilesOf(data: DataTransfer | null): File[] {
	return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

/**
 * One insertion, not one per image: a hook may return multi-line markdown, whose structural
 * paste can split the block out from under a second insertion aimed at anchor plus length,
 * and one paste gesture should be one undo entry.
 */
async function importAll(
	deps: ImagePasteArmDeps,
	importImage: PasteImageHook,
	files: File[]
): Promise<string> {
	const markdown: string[] = [];
	for (const image of files) {
		try {
			const inserted = await importImage({
				blob: image,
				mimeType: image.type,
				suggestedName: image.name || undefined
			});
			if (inserted) markdown.push(inserted);
		} catch (error) {
			// One failed import skips its image; the rest of the paste still lands. Still
			// a clipboard failure, not a command throw: the host needs to know an asset
			// it started importing will not appear in the document.
			emitClipboardError(deps.events, { error });
		}
	}
	return markdown.join('');
}
