/**
 * The host image-import arm of a paste, shared by the editable-surface clipboard skeleton and the
 * editor-root fallback. It ends at "here is the markdown nobody claimed"; each caller owns what
 * happens next. Two ordering rules: files are read before the first await (`clipboardData` is not
 * dependably live afterwards), and a multi-block selection reaches the delete only after the hook
 * answers, so a failed import destroys nothing.
 */

import type { PasteImageHook } from '../editor-keys';
import { emitClipboardError, type EditorEvents } from '../editor-events';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';

export interface ImagePasteArmDeps {
	/** Undefined leaves an image-bearing paste on the text/plain path — `filesOf`
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
	 * Import `files` in clipboard order, then offer the markdown to the cross-block
	 * seam. Null means the arm is finished (nothing imported, or a multi-block
	 * selection took the insertion); markdown means no selection claimed it.
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
			// Empty markdown ends the arm like no markdown, and keeps the seam's payload
			// below non-empty.
			if (!markdown) return null;
			// Inherit the ordinary paste route rather than placing anything here: the
			// delete collapses start-wins and the receiving block may be merged away. The
			// seam reads `isCrossBlock` LIVE, so a mid-import selection is the one replaced.
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
 * One insertion, not one per image: a hook may return multi-line markdown, whose
 * structural paste can split the block out from under a second insertion addressed at
 * anchor + length — and one paste gesture owes the user one undo entry.
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
