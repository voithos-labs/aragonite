/**
 * The host image-import arm of a paste, shared by the editable-surface clipboard
 * skeleton and the editor-root fallback. Both callers face the same clipboard and
 * the same hook; only what they can do with the markdown differs — a surface has a
 * caret to insert at, the root has nothing but the cross-block seam — so the arm
 * ends at "here is the markdown nobody claimed" and each caller owns its policy.
 *
 * Its ordering rules, stated once so no caller re-derives them: the files are read
 * before the first await (`clipboardData` is not dependably live afterwards), and
 * the multi-block selection is offered to the delete only after the hook has
 * answered, so a declined or failed import destroys nothing.
 */

import type { PasteImageHook } from '../editor-keys';
import { emitClipboardError, type EditorEvents } from '../editor-events';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';

export interface ImagePasteArmDeps {
	/** Host import hook. Undefined leaves an image-bearing paste on the text/plain
	 *  path, exactly as before the hook existed — `filesOf` then reports none. */
	onPasteImage: PasteImageHook | undefined;
	/** The instance event surface: a failed import reports here rather than vanishing. */
	events: EditorEvents;
	crossBlock: CrossBlockHandlers;
}

export interface ImagePasteArm {
	/** The image files this paste carries, empty when no hook is installed. Call
	 *  before the handler's first await. */
	filesOf(data: DataTransfer | null): File[];
	/**
	 * Import `files` in clipboard order, then offer the markdown to the cross-block
	 * seam. Returns null when the arm is finished — nothing was imported, or a
	 * multi-block selection took the insertion — and the markdown when no selection
	 * claimed it, for a caller that has somewhere else to put it.
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
			// Empty markdown ends the arm like no markdown: there is nothing to insert
			// either way, and it keeps the payload below non-empty for the seam.
			if (!markdown) return null;
			// A multi-block selection is REPLACED, like every other paste route — and by
			// inheriting that route rather than placing anything here, since the delete
			// collapses start-wins and the block that received the event may be the one
			// merged away. `isCrossBlock` is read LIVE inside the seam, so a selection
			// made WHILE the import was in flight is the one replaced and a selection
			// collapsed before it landed falls through to the caller.
			if (await deps.crossBlock.handlePaste(e, markdown)) return null;
			return markdown;
		}
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/** A paste can carry a plain attachment alongside its text; only image files
 *  belong to the host hook, the rest stays on the text/plain path. */
function imageFilesOf(data: DataTransfer | null): File[] {
	return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

/**
 * Offer each image to the hook and join what comes back into ONE insertion, not one
 * per image: a hook may return multi-line markdown, whose structural paste can split
 * the block out from under a second insertion addressed at anchor + length, and one
 * paste gesture owes the user one undo entry.
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
			// a clipboard failure, not a command throw: the host reads it for the same
			// reason it reads a decline — to know an asset it started importing is not
			// going to appear in the document.
			emitClipboardError(deps.events, { error });
		}
	}
	return markdown.join('');
}
