import fc from 'fast-check';
import type { Document } from '../../../core/nodes';
import type { EditorSelection } from '../../../selection/primitives';
import { arbParsedDoc, allBlockPaths } from './cst';

/**
 * A parsed doc paired with a selection whose endpoints are two DISTINCT block
 * paths drawn from the doc (cross-block). Offsets are small non-negative ints —
 * the document-order classification/walk compares offsets numerically and never
 * slices `raw`, so any value is valid here. Docs with fewer than two blocks are
 * filtered out so the selection is always genuinely cross-block.
 */
export const arbDocWithSelection: fc.Arbitrary<{
	doc: Document;
	selection: EditorSelection;
}> = arbParsedDoc
	.map((doc) => ({ doc, paths: allBlockPaths(doc) }))
	.filter(({ paths }) => paths.length >= 2)
	.chain(({ doc, paths }) => {
		const index = fc.integer({ min: 0, max: paths.length - 1 });
		const offset = fc.integer({ min: 0, max: 10 });
		return fc
			.tuple(index, offset, index, offset)
			.filter(([a, , b]) => a !== b)
			.map(([ai, ao, bi, bo]) => ({
				doc,
				selection: {
					anchor: { path: paths[ai], offset: ao },
					focus: { path: paths[bi], offset: bo }
				}
			}));
	});
