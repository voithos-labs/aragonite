/**
 * The document always holds a block: a structural commit that leaves it none gives it one empty
 * paragraph. The commit runs this step in both its branches, so no edit writes that paragraph.
 */

import type { StructuralChange } from './structural-change';
import type { SharingState } from './sharing';
import { emptyParagraph, type BodyParent } from './node-primitives';

/** When `body` (the document's) has no children, gives it the empty paragraph and returns `change`
 *  widened to cover it; `body.lineEnding` was read before the edit, so the paragraph keeps it. */
export function keepOneBlock(
	body: BodyParent,
	change: StructuralChange,
	sharing: SharingState
): StructuralChange {
	if (body.children.length > 0) return change;
	const filler = emptyParagraph('', body.lineEnding);
	sharing.stamp(filler);
	body.children.push(filler);
	// With nothing left, the change's window started at 0 and held every block there was.
	const removed = change.op === 'delete' || change.op === 'replace' ? change.count : 0;
	return removed === 0
		? { op: 'insert', at: 0, count: 1 }
		: { op: 'replace', at: 0, count: removed, newCount: 1 };
}
