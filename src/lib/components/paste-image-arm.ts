/**
 * Hands a paste's images to the host's import hook and answers the Markdown it returns, which the
 * editor's paste entry lands where the paste was aimed.
 */

import type { PasteImageHook } from '../host-hooks';
import { emitClipboardError, type EditorEvents } from '../editor-events';

export interface ImagePasteArmDeps {
	/** Read at each paste; undefined leaves a paste carrying images on the text/plain path. */
	onPasteImage: () => PasteImageHook | undefined;
	/** A failed import reports here rather than vanishing. */
	events: EditorEvents;
}

export interface ImagePasteArm {
	/** The images among a paste's files; empty when no hook is installed. */
	filesOf(files: readonly File[]): File[];
	/** Imports `files` in clipboard order: the Markdown the host answered, joined, or ''. */
	run(files: File[]): Promise<string>;
}

export function createImagePasteArm(deps: ImagePasteArmDeps): ImagePasteArm {
	return {
		// A paste can carry a plain attachment beside its text; only images are the host's.
		filesOf: (files) =>
			deps.onPasteImage() ? files.filter((file) => file.type.startsWith('image/')) : [],
		async run(files) {
			const importImage = deps.onPasteImage();
			return importImage ? importAll(deps, importImage, files) : '';
		}
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

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
