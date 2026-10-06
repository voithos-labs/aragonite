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
	const exit = dissolveItem(list, itemIndex, emptyParagraph('', lineEnding));
	return { blocks: exit.blocks, paragraphIndex: exit.firstBlockIndex };
}
