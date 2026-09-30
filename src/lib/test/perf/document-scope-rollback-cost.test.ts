// @vitest-environment jsdom
// Miss-analysis: nothing counted what a rollback saves, so a document-scope commit saving every
// top-level block, for an unwind that only needs the array it replaced, went unnoticed.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import {
	performCrossBlockDelete,
	type CrossBlockMutationContext
} from '$lib/selection/cross-block/ops';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';

const BLOCKS = 25_000;

/** Counts reads of each block's `metadata`: saving a block for the rollback reads it with its
 *  bytes, and nothing else in a delete this far from a block reads either. */
function countMetadataReads(children: CstNode[]): () => number {
	let reads = 0;
	for (const node of children) {
		let metadata = node.metadata;
		Object.defineProperty(node, 'metadata', {
			configurable: true,
			enumerable: true,
			get() {
				reads++;
				return metadata;
			},
			set(value) {
				metadata = value;
			}
		});
	}
	return () => reads;
}

describe('a cross-block delete over the document scope on a giant document', () => {
	it('saves no top-level block for its rollback', async () => {
		const paragraphs = Array.from({ length: BLOCKS }, (_, i) => `p${i}\n`).join('\n');
		const harness = makeEditorActionsDeps(parse(`> quoted\n\n${paragraphs}`).children);
		const { deps } = harness;
		deps.selectionState = createSelectionState({ getDoc: () => deps.doc });
		const ctx: CrossBlockMutationContext = {
			selection: deps.selectionState,
			getDoc: () => deps.doc,
			getBlockElByPath: () => null,
			revealPath: (path) => deps.caretLanding.mount(path),
			controller: createUndoController(deps),
			reading: fixtureReading()
		};
		const reads = countMetadataReads(deps.doc.children);
		// From inside the quote into the first paragraph: the document is the common ancestor.
		deps.selectionState.enterCrossBlock({ path: [0, 0], offset: 1 }, { path: [1], offset: 1 });

		await performCrossBlockDelete(ctx, 'keyless');

		expect(deps.doc.children).toHaveLength(BLOCKS);
		expect(reads()).toBeLessThan(100);
	});
});
