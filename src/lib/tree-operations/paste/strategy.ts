import type { CstNode } from '../../core/nodes';
import type { PasteStrategy } from './dispatch';
import { isBlankParagraph } from '../../core/parser';

/**
 * The clipboard's content blocks: a blank block at either edge is the copy's packaging, which a
 * surface holding no blocks classifies past. Empty when nothing but packaging came across.
 */
export function contentBlocks(blocks: readonly CstNode[]): readonly CstNode[] {
	let start = 0;
	let end = blocks.length;
	while (start < end && isBlankParagraph(blocks[start])) start++;
	while (end > start && isBlankParagraph(blocks[end - 1])) end--;
	return blocks.slice(start, end);
}

/** One paragraph is text any leaf can take inline; anything else is structure. */
export function pickPasteStrategy(blocks: readonly CstNode[]): PasteStrategy {
	if (blocks.length === 0) return 'inline';
	return blocks.length === 1 && blocks[0].kind === 'paragraph' ? 'inline' : 'structural';
}
