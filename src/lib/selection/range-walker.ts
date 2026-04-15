/**
 * Document-order iteration over block paths between two endpoints.
 * Pure function over a Document tree — no DOM, no state.
 */

import type { CstNode, Document } from '../core/nodes';
import { comparePaths, isPathBetween } from './selection-point';

/**
 * Return every block path strictly between `start` and `end` in document order.
 * Exclusive of both endpoints. Walks every nesting level.
 *
 * Used by range-delete to collect deletion targets, and by cross-block copy
 * to collect middle blocks whose text contributes to the clipboard payload.
 */
export function walkBetween(
	doc: Document,
	start: number[],
	end: number[]
): number[][] {
	if (comparePaths(start, end) >= 0) return [];

	const result: number[][] = [];

	function visit(node: CstNode | Document, path: number[]): void {
		if (isPathBetween(path, start, end)) {
			result.push([...path]);
		}
		if (!node.children) return;
		for (let i = 0; i < node.children.length; i++) {
			const childPath = [...path, i];
			// Short-circuit: if the entire subtree is before start or after end,
			// we can skip it. This is O(path length) per skip — cheap.
			const firstDescendant = [...childPath];
			const lastDescendant = [...childPath, ...Array(8).fill(Number.MAX_SAFE_INTEGER)];
			if (comparePaths(lastDescendant, start) <= 0) continue;
			if (comparePaths(firstDescendant, end) >= 0) break;
			visit(node.children[i], childPath);
		}
	}

	visit(doc, []);
	return result;
}
