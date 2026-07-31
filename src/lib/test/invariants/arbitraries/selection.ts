import fc from 'fast-check';
import type { Document } from '../../../core/nodes';
import type { EditorSelection } from '../../../selection/primitives';
import { arbParsedDoc, allBlockPaths } from './cst';

/**
 * A parsed doc paired with a genuinely cross-block selection — two DISTINCT block paths
 * drawn from the doc. Offsets can be any small int: the document-order walk compares them
 * numerically and never slices `raw`.
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
