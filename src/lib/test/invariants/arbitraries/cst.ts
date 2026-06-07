import fc from 'fast-check';
import type { CstNode, Document } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import { arbGfmDoc } from './gfm';

/**
 * Parsed `Document` trees derived from `arbGfmDoc` source. Tests that mutate or
 * walk the tree consume the parsed form; round-trip tests consume the source.
 */
export const arbParsedDoc: fc.Arbitrary<Document> = arbGfmDoc.map(parse);

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
