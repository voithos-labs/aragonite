// A draft registry for a suite that opens and closes drafts but never commits one.
import { createDraftRegistry } from '#lib/editor-actions/commit/draft-registry.svelte.js';
import {
	createDocumentStamps,
	type DocumentStamps
} from '#lib/editor-actions/commit/document-stamp.js';
import { parse } from '#lib/core/parser.js';
import type { DocumentView } from '#lib/core/node-views.js';

export function idleDraftRegistry(
	stamps: DocumentStamps = createDocumentStamps(),
	doc: () => DocumentView = () => parse('\n')
) {
	return createDraftRegistry({
		stamps,
		doc,
		isReading: () => false,
		writes: () => ({
			commitSource: async () => false,
			undoStep: async (_seed, run) => void (await run()),
			insert: async () => false
		})
	});
}
