import fc from 'fast-check';
import type { CstNode, Document } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import { arbGfmDoc, arbIndentedGfmDoc } from './gfm';

/**
 * Parsed `Document` trees derived from GFM source. Tests that mutate or walk the
 * tree consume the parsed form; round-trip tests consume the source.
 *
 * Both source lanes feed it: the tree shapes an indent produces differ from the
 * column-0 ones (four spaces turns a marker into indented code, so a container
 * the unindented draw would have built becomes a leaf), and the suites that walk
 * or partition a tree are exactly the ones that should see both.
 */
export const arbParsedDoc: fc.Arbitrary<Document> = fc
	.oneof(arbGfmDoc, arbIndentedGfmDoc)
	.map(parse);

/**
 * Every block path in document order (ancestor before descendants), excluding
 * the empty root path. Mirrors `walkBetween`'s traversal so selection tests can
 * pick endpoints from paths that actually address blocks.
 */
export function allBlockPaths(doc: Document): number[][] {
	const paths: number[][] = [];
	function visit(children: CstNode[] | undefined, prefix: number[]): void {
		if (!children) return;
		for (let i = 0; i < children.length; i++) {
			const path = [...prefix, i];
			paths.push(path);
			visit(children[i].children, path);
		}
	}
	visit(doc.children, []);
	return paths;
}
