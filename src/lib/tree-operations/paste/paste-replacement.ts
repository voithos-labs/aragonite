/**
 * How a clipboard's blocks land under a block already in the document: the first is set a blank
 * line apart where it would otherwise continue the block above on reload.
 */

import type { CstNode } from '../../core/nodes';
import { isBlankParagraph } from '../../core/parser';
import { ensureEditableContainers } from '../../schema/opened-reading';

/** The clipboard's blocks as they land after `prev`; the commit ends the last one's line. */
export function landClipboardBlocks(
	prev: CstNode | undefined,
	blocks: readonly CstNode[],
	lineEnding: '\n' | '\r\n'
): CstNode[] {
	const landed: CstNode[] = [];
	for (let i = 0; i < blocks.length; i++) {
		// The clipboard's parse already read its own blocks as themselves, so only the join with
		// the text above is new.
		const node = i === 0 && prev ? landedAfter(prev, blocks[i], lineEnding) : { ...blocks[i] };
		ensureEditableContainers(node, lineEnding);
		landed.push(node);
	}
	return landed;
}

/**
 * A copy of `block` landing after `prev`, given a blank line where the clipboard gave none, or it
 * would continue `prev` on reload; a blank `prev` already separates it.
 */
export function landedAfter(prev: CstNode, block: CstNode, lineEnding: '\n' | '\r\n'): CstNode {
	const separated = block.leadingTrivia !== '' || isBlankParagraph(prev);
	return { ...block, leadingTrivia: separated ? block.leadingTrivia : lineEnding };
}
