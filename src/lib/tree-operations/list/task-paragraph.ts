/**
 * How a write reads one block's bytes back in place. A task item's first paragraph starts right
 * after the marker, so its text reads as the parser reads the item body (GFM task lists): the
 * first line stays paragraph text whatever it would open. Everywhere else it is a plain fragment.
 */

import { metadataOf, type Document } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { parse, parseTaskItemBody } from '../../core/parser';
import type { GrammarView } from '../../schema/block-openers';

export type FragmentReader = (text: string) => Document;

/** Whether the block at `index` under `owner` is the paragraph a task marker stands in front of. */
export function followsTaskMarker(owner: NodeView | undefined, index: number): boolean {
	return (
		index === 0 && owner?.kind === 'listItem' && metadataOf(owner, 'listItem')?.taskItem === true
	);
}

export function fragmentReaderAt(
	owner: NodeView | undefined,
	index: number,
	grammar: GrammarView | undefined
): FragmentReader {
	// Fragment scope: these are one block's bytes, so a kind that depends on document position
	// must not be produced here.
	return followsTaskMarker(owner, index)
		? (text) => parseTaskItemBody(text, grammar)
		: (text) => parse(text, { grammar, scope: 'fragment' });
}
