// Draft registries for suites without a mounted editor: one that never commits, and one that
// commits through a harness's byte splice, as the editor wires its own.
import { createDraftRegistry } from '#lib/editor-actions/commit/draft-registry.svelte.js';
import {
	createDocumentStamps,
	type DocumentStamps
} from '#lib/editor-actions/commit/document-stamp.js';
import { parse } from '#lib/core/parser.js';
import type { DocumentView } from '#lib/core/node-views.js';
import type { TopHarness } from './editor-actions';
import { measured } from '#lib/tree-operations/top-level-starts.js';

export function idleDraftRegistry(
	stamps: DocumentStamps = createDocumentStamps(),
	doc: () => DocumentView = () => parse('\n')
) {
	return createDraftRegistry({
		stamps,
		doc,
		measured: () => measured(doc()),
		isReading: () => false,
		writes: () => ({
			commitSource: async () => false,
			undoStep: async (_seed, run) => void (await run()),
			insert: async () => false
		})
	});
}

export function draftRegistryOver(h: TopHarness) {
	return createDraftRegistry({
		stamps: createDocumentStamps(),
		doc: () => h.deps.doc,
		measured: () => h.deps.bytes.measured(),
		isReading: () => false,
		writes: () => ({
			commitSource: h.controller.commitSource,
			undoStep: (seed, run) => h.controller.undoStep(seed, run),
			insert: async () => false
		})
	});
}
