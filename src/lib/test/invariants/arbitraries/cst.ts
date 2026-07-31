import fc from 'fast-check';
import type { CstNode, Document } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import { arbGfmDoc, arbIndentedGfmDoc } from './gfm';

/**
 * Parsed `Document` trees for suites that mutate or walk a tree. Both source lanes feed
 * it because an indent changes the shape (four spaces turns a marker into indented code,
 * so a container the unindented draw would have built becomes a leaf).
 */
export const arbParsedDoc: fc.Arbitrary<Document> = fc
	.oneof(arbGfmDoc, arbIndentedGfmDoc)
	.map(parse);

/**
 * Every block path in document order, excluding the empty root path. Mirrors
 * `walkBetween`'s traversal so selection endpoints address paths that really exist.
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
