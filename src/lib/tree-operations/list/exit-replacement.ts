import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { LineEnding } from '../../core/lines';
import { emptyParagraph } from '../node-primitives';
import { dissolveItem } from './item-partition';

/**
 * The replacement when an empty item exits its list: a fresh paragraph where the item's line was,
 * the item's other children after it in the order they read, and the list's halves around them.
 */
export function buildExitReplacement(
	list: NodeView,
	itemIndex: number,
	lineEnding: LineEnding
): { blocks: CstNode[]; paragraphIndex: number } {
	// Every byte this op creates is a line ending, the document's.
	const { blocks, firstBlockIndex } = dissolveItem(list, itemIndex, emptyParagraph('', lineEnding));
	// Without a blank line under the list above, the parser lazy-continues a typed line into the
	// list's last item on reload.
	if (firstBlockIndex > 0) blocks[firstBlockIndex].leadingTrivia = lineEnding;
	return { blocks, paragraphIndex: firstBlockIndex };
}
