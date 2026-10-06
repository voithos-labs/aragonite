/**
 * How bytes written into one child slot read back in place. A list item's first block sits on its
 * marker line, so bytes written there read as a reload reads that whole line, checkbox included
 * (GFM task lists). Everywhere else they read as a plain fragment.
 */

import {
	makeBlockNode,
	metadataOf,
	type CstNode,
	type Document,
	type ListItemMetadata
} from '../../core/nodes';
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

/** The reader every write into slot `index` under `owner` installs its bytes through: it keeps
 *  every byte, so a space the marker line takes stays on the first block for the item to adopt. */
export function fragmentReaderAt(
	owner: NodeView | undefined,
	index: number,
	grammar: GrammarView
): FragmentReader {
	const meta = index === 0 && owner?.kind === 'listItem' ? metadataOf(owner, 'listItem') : null;
	if (meta) {
		return (text) => readBehindMarkerLine(meta, text, grammar) ?? readItemBody(meta, text, grammar);
	}
	// Fragment scope: these are one block's bytes, so a kind that depends on document position
	// must not be produced here.
	return (text) => readBlocks(text, { grammar, scope: 'fragment' });
}

/** `text` read as the list item `owner` reads its first block, behind its marker line; null when
 *  that is not one item or changes its task state (a marker widened over a space is still one). */
export function readThroughItemMarker(
	owner: NodeView,
	text: string,
	grammar: GrammarView
): Document | null {
	const read = readMarkerLine(metadataOf(owner, 'listItem'), text, grammar);
	return read && { kind: 'document', prefix: '', children: read.children, suffix: '' };
}

// ── The marker line ──────────────────────────────────────────────────────────

interface MarkerLineRead {
	/** The marker and checkbox the line reads as, wider than the item's own over a leading space. */
	metadata: ListItemMetadata;
	children: CstNode[];
	/** Blank lines after the item, which the fragment parse splits off. */
	suffix: string;
}

/** The marker and checkbox an item's first line reads as when its first block's leading spaces
 *  widen them, and how many spaces they take off that block; null when the line keeps its own. */
export function markerLineWidening(
	item: NodeView,
	grammar: GrammarView
): { metadata: ListItemMetadata; taken: number } | null {
	const meta = metadataOf(item, 'listItem');
	const first = item.children?.[0];
	if (!meta || !first) return null;
	const ending = first.raw.indexOf('\n');
	const read = readMarkerLine(
		meta,
		ending < 0 ? first.raw : first.raw.slice(0, ending + 1),
		grammar
	);
	if (!read) return null;
	const width = (m: ListItemMetadata) => m.marker.length + (m.taskMarker?.length ?? 0);
	const taken = width(read.metadata) - width(meta);
	if (taken <= 0 || !/^[ \t]+$/.test(first.raw.slice(0, taken))) return null;
	return { metadata: read.metadata, taken };
}

/** `text` behind `meta`'s marker line, as one item holding the same checkbox, or null. */
function readMarkerLine(
	meta: Readonly<ListItemMetadata>,
	text: string,
	grammar: GrammarView
): MarkerLineRead | null {
	const probe = makeBlockNode({
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: { ...meta },
		children: [makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: text })]
	});
	rebuildListItemRaw(probe);
	const doc = readBlocks(probe.raw, { grammar, scope: 'fragment' });
	const lists = doc.children;
	const items = lists.length === 1 && lists[0].kind === 'list' ? (lists[0].children ?? []) : [];
	const item = items.length === 1 && items[0].kind === 'listItem' ? items[0] : null;
	if (!item) return null;
	const read = metadataOf(item, 'listItem');
	if (read.taskItem !== meta.taskItem || read.taskChecked !== meta.taskChecked) return null;
	return { metadata: read, children: item.children ?? [], suffix: doc.suffix };
}

/** {@link readMarkerLine} for a write, which keeps every byte: null unless the item's blocks hold
 *  all of `text` but a leading run of spaces, which then stays on the first block. */
function readBehindMarkerLine(
	meta: Readonly<ListItemMetadata>,
	text: string,
	grammar: GrammarView
): Document | null {
	const read = readMarkerLine(meta, text, grammar);
	if (!read) return null;
	const { children, suffix } = read;
	const tail = children.map((child, i) => (i === 0 ? '' : child.leadingTrivia) + child.raw);
	const kept = tail.join('') + suffix;
	if (!text.endsWith(kept)) return null;
	const lead = text.slice(0, text.length - kept.length);
	if (lead === '') return { kind: 'document', prefix: '', children, suffix };
	if (!/^[ \t]+$/.test(lead) || children.length === 0) return null;
	children[0].raw = lead + children[0].raw;
	return { kind: 'document', prefix: '', children, suffix };
}

/** An item's body read without its marker line: a to-do's text still starts its first line, so
 *  that line stays paragraph text. */
function readItemBody(
	meta: Readonly<ListItemMetadata>,
	text: string,
	grammar: GrammarView
): Document {
	return meta.taskItem
		? parseTaskItemBody(text, grammar)
		: readBlocks(text, { grammar, scope: 'fragment' });
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
