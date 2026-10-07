// An item merge as the Backspace commit runs it: the merge, then the commit's rebuild of the list,
// which the merge leaves to the commit.

import type { CstNode } from '#lib/core/nodes.js';
import type { Reading } from '#lib/schema/reading.js';
import type { SharingState } from '#lib/tree-operations/sharing.js';
import { rebuildListRaw } from '#lib/schema/container-rebuilders.js';
import { mergeListItemIntoPrevious as mergeOnly } from '#lib/tree-operations/list/unwrap-merge.js';

export function mergeListItemIntoPrevious(
	list: CstNode,
	children: CstNode[],
	currentIndex: number,
	sharing: SharingState,
	reading: Reading
): ReturnType<typeof mergeOnly> {
	const result = mergeOnly(list, children, currentIndex, sharing, reading);
	if (result) rebuildListRaw(list);
	return result;
}
