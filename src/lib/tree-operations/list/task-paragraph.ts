/**
 * How one block's bytes read back in place. A task item's first paragraph starts right after the
 * marker, so a write reads its text as the parser reads the item body (GFM task lists); a live
 * rewrite's check reads a list item's first block behind its whole marker line. Everywhere else
 * it is a plain fragment.
 */

import { makeBlockNode, metadataOf, type Document } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import { blockNodeAt } from '../node-primitives';
import { readBlocks, parseTaskItemBody } from '../../core/parser';
import type { GrammarView } from '../../schema/block-openers';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';

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
	grammar: GrammarView
): FragmentReader {
	// Fragment scope: these are one block's bytes, so a kind that depends on document position
	// must not be produced here.
	return followsTaskMarker(owner, index)
		? (text) => parseTaskItemBody(text, grammar)
		: (text) => readBlocks(text, { grammar, scope: 'fragment' });
}

/** `text` read as the list item `owner` reads its first block, behind its marker line; null when
 *  that is not one item or changes its task state (a marker widened over a space is still one). */
export function readThroughItemMarker(
	owner: NodeView,
	text: string,
	grammar: GrammarView
): Document | null {
	const meta = metadataOf(owner, 'listItem');
	const probe = makeBlockNode({
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: { ...meta },
		children: [makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: text })]
	});
	rebuildListItemRaw(probe);
	const lists = readBlocks(probe.raw, { grammar, scope: 'fragment' }).children;
	const items = lists.length === 1 && lists[0].kind === 'list' ? (lists[0].children ?? []) : [];
	const item = items.length === 1 && items[0].kind === 'listItem' ? items[0] : null;
	if (!item) return null;
	const read = metadataOf(item, 'listItem');
	if (read.taskItem !== meta.taskItem || read.taskChecked !== meta.taskChecked) return null;
	return { kind: 'document', prefix: '', children: item.children ?? [], suffix: '' };
}

/** A child slot: the block holding it (none at the document's top level) and its index there. */
export interface ChildSlot {
	owner: NodeView | undefined;
	index: number;
}

/** The slot a document path names. */
export function childSlotAt(doc: DocumentView, path: readonly number[]): ChildSlot {
	const found = path.length > 1 ? blockNodeAt(doc, path.slice(0, -1)) : null;
	const owner = found ?? undefined;
	return { owner, index: path[path.length - 1] };
}

/** {@link fragmentReaderAt} for the slot a document path names. */
export function slotReaderAt(
	doc: DocumentView,
	path: readonly number[],
	grammar: GrammarView
): FragmentReader {
	const { owner, index } = childSlotAt(doc, path);
	return fragmentReaderAt(owner, index, grammar);
}
