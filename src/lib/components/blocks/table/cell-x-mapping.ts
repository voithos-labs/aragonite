// Pick the column whose horizontal range contains an editor-relative pixel X.
// Used for boundary entry — when the user arrows down out of a paragraph into
// the table, we land them in the cell closest to where they were horizontally.
// The result is a column index (a plain number), not a row-major cell index.

import type { EditorX } from '../../../cursor/coordinate-spaces';

export interface ColumnRect {
	left: number;
	right: number;
}

export function columnNearestX(x: EditorX, rects: ColumnRect[]): number {
	if (rects.length === 0) return 0;
	if (x < rects[0].left) return 0;
	if (x >= rects[rects.length - 1].right) return rects.length - 1;
	for (let i = 0; i < rects.length; i++) {
		if (x >= rects[i].left && x < rects[i].right) return i;
	}
	return rects.length - 1;
}
