// Shared fixtures for the range-delete table family. Row counts exclude the separator line.

import type { CstNode, Document } from '../../core/nodes';

export const TWO_COL_FOUR_ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';
export const TWO_COL_THREE_ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

export function findTable(doc: Document): CstNode | null {
	for (const child of doc.children) {
		if (child.kind === 'table') return child;
	}
	return null;
}
