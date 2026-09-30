/**
 * Hands a paste's images to the host's import hook, for the blocks' clipboard code and the
 * editor-root fallback alike. Files are read before the first await, since `clipboardData` may
 * not stay live, and a multi-block selection is deleted only after the hook answers.
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
	/** Imports `files` in clipboard order and offers the markdown to the cross-block paste; null
	 *  when nothing is left to do, the markdown when no selection took it. */
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
			// The ordinary paste route, which reads `isCrossBlock` live, since the delete can
			// collapse or merge away the receiving block.
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

/** One insertion for every image: multi-line markdown can split the block out from under a
 *  second insertion, and one paste is one undo entry. */
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
			// A failed import skips its image and reports a clipboard error, so the host knows
			// that asset will not appear.
			emitClipboardError(deps.events, { error });
		}
	}
	return markdown.join('');
}
