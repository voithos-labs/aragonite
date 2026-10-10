// @vitest-environment jsdom
// Miss-analysis: nothing counted what a rollback saves, so a document-scope commit saving every
// top-level block, for an unwind that only needs the array it replaced, went unnoticed.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { replaceRange } from '#lib/selection/cross-block/range-replace.js';
import { rangeContext } from '../selection/cross-block/range-context';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '../harness/fixture-grammar';

const BLOCKS = 500;

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

describe('a cross-block delete over the document scope', () => {
	it('saves no top-level block for its rollback', async () => {
		const paragraphs = Array.from({ length: BLOCKS }, (_, i) => `p${i}\n`).join('\n');
		const harness = makeEditorActionsDeps(parse(`> quoted\n\n${paragraphs}`).children);
		const { deps } = harness;
		deps.selectionState = createSelectionState({ getDoc: () => deps.doc });
		const ctx = rangeContext(deps, createUndoController(deps), fixtureReading());
		const reads = countMetadataReads(deps.doc.children);
		// From inside the quote into the first paragraph: the document is the common ancestor.
		deps.selectionState.enterCrossBlock({ path: [0, 0], offset: 1 }, { path: [1], offset: 1 });

		await replaceRange(ctx, { kind: 'none', gesture: 'Backspace' });

		expect(deps.doc.children).toHaveLength(BLOCKS);
		// The count is exact (a delete reads 5), so a fiftieth of the blocks catches a partial save.
		expect(reads()).toBeLessThan(BLOCKS / 50);
	});
});
