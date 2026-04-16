/**
 * Pure classification helper for SelectionOverlay: given a block's path
 * and an EditorSelection, decides whether the block is the start
 * endpoint, a middle block, the end endpoint, the two endpoints in one
 * block (single-block case — native handles it), or entirely outside
 * the range.
 */

import type { EditorSelection } from './selection-types';
import { comparePaths, isPathBetween, normalize } from './selection-point';

export type BlockSelectionClass = 'outside' | 'start' | 'middle' | 'end' | 'single-block';

export function classifyBlockForSelection(
	path: number[],
	selection: EditorSelection
): BlockSelectionClass {
	const { start, end } = normalize(selection);
	if (comparePaths(start.path, end.path) === 0) {
		return comparePaths(path, start.path) === 0 ? 'single-block' : 'outside';
	}
	if (comparePaths(path, start.path) === 0) return 'start';
	if (comparePaths(path, end.path) === 0) return 'end';
	if (isPathBetween(path, start.path, end.path)) return 'middle';
	return 'outside';
}
