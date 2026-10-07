/**
 * Keeps a list item's task metadata in step with its first block. The parser keeps the task marker
 * in the item's metadata, but a write changes only the block, so every write into an item's first
 * slot goes through `writeKeepingTaskMarker`, which reconciles the marker with what stands there.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf, type ListItemMetadata } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { matchTaskCheckbox } from '../../core/parsers/list';
import { CURSOR_END } from '../../block-component';
import type { GrammarView } from '../../schema/block-openers';
import type { SharingState } from '../sharing';
import { ensureUnsharedChild } from '../unshare';
import { followsTaskMarker, fragmentReaderAt, readThroughItemMarker } from './task-paragraph';

/** Runs `write` against the child at `slot`, then reconciles the owner's task marker with what
 *  stands there now. Pass the owner as the tree holds it once any copy before the write is made. */
export function writeKeepingTaskMarker<T>(
	owner: CstNode | undefined,
	children: readonly CstNode[],
	slot: number,
	sharing: SharingState,
	write: () => T
): T {
	// Read before the write, which can put a block there no task marker may stand before.
	const stood = children[slot] !== undefined && taskMarkerMayStandBefore(children[slot]);
	const result = write();
	if (owner) reconcileTaskMetadata(owner, slot, stood, sharing);
	return result;
}

/** Blocks replacing a to-do's first block, as they land, and where a caret in them moves. */
export interface TaskStartLanding {
	nodes: CstNode[];
	/** A caret at `offset` in the replacement's block `index`, in `nodes`. */
	caretAt(index: number, offset: number): { index: number; offset: number };
}

/** Blocks landing in a to-do's first slot: one the bare bullet can't hold reads as the to-do's
 *  text instead of taking the box's place. Null when they land as given. */
export function landAtTaskStart(
	owner: NodeView | undefined,
	index: number,
	replacement: readonly CstNode[],
	grammar: GrammarView
): TaskStartLanding | null {
	if (!owner || !followsTaskMarker(owner, index) || replacement.length === 0) return null;
	if (taskMarkerMayStandBefore(replacement[0])) return null;
	const bytes = bytesOf(replacement);
	const bareBullet: NodeView = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: {
			...metadataOf(owner, 'listItem'),
			taskItem: false,
			taskChecked: false,
			taskMarker: null
		}
	};
	const held = readThroughItemMarker(bareBullet, bytes, grammar)?.children[0];
	if (held?.kind === replacement[0].kind) return null;

	const read = fragmentReaderAt(owner, 0, grammar)(bytes);
	const nodes = read.children;
	if (nodes.length === 0) return null;
	// The blank lines the parse split off are still the replacement's bytes.
	nodes[nodes.length - 1].raw += read.suffix;
	return { nodes, caretAt: (at, offset) => caretIn(nodes, byteAt(replacement, at, offset)) };
}

/** Whether a task marker may stand in front of this block: only its own paragraph (GFM task lists). */
function taskMarkerMayStandBefore(block: NodeView): boolean {
	return block.kind === 'paragraph';
}

/**
 * Align the item's task fields with a fresh parse of its first line, putting a demoted marker's
 * bytes back in the paragraph; the marker is dropped only if it stood before the replaced block.
 */
export function reconcileTaskMetadata(
	listItem: CstNode,
	writtenIndex: number,
	markerStoodBefore: boolean,
	sharing: SharingState
): void {
	if (listItem.kind !== 'listItem' || writtenIndex !== 0) return;
	const firstChild = listItem.children?.[0];
	if (!firstChild) return;

	const meta = metadataOf(listItem, 'listItem');
	if (!meta) return;

	if (firstChild.kind !== 'paragraph') {
		// A task marker stands before a paragraph (GFM § 5.3), so the write that puts a block there
		// the marker cannot stand in front of gives the checkbox up with the paragraph it had.
		if (!meta.taskItem || !markerStoodBefore) return;
		if (taskMarkerMayStandBefore(firstChild)) return;
		meta.taskItem = false;
		meta.taskMarker = null;
		meta.taskChecked = false;
		return;
	}

	const firstLineText = firstLineTextOf(firstChild.raw);
	// The first line's ending stays with the rest of the paragraph.
	const restRaw = firstChild.raw.slice(firstLineText.length);
	const { match, kept } = splitTaskLine(meta, firstLineText);

	if (match) {
		const drift =
			meta.taskItem !== true ||
			meta.taskMarker !== match.rawMarker ||
			meta.taskChecked !== match.checked;
		if (drift) {
			meta.taskItem = true;
			meta.taskMarker = match.rawMarker;
			meta.taskChecked = match.checked;
			ownedFirstChild(listItem, sharing).raw = kept + restRaw;
		}
		return;
	}

	if (meta.taskItem === true || meta.taskMarker !== null) {
		ownedFirstChild(listItem, sharing).raw = kept + restRaw;
		meta.taskItem = false;
		meta.taskMarker = null;
		meta.taskChecked = false;
	}
}

/**
 * How far back a caret in the first paragraph moves when writing `text` there takes a task marker
 * off its front; read before the write, while the item still holds its current marker.
 */
export function taskMarkerCaretShift(listItem: NodeView, text: string): number {
	if (listItem.kind !== 'listItem') return 0;
	const meta = metadataOf(listItem, 'listItem');
	if (!meta) return 0;
	const firstLineText = firstLineTextOf(text);
	return splitTaskLine(meta, firstLineText).kept.length - firstLineText.length;
}

/** The checkbox the item's first line reads as once `firstLineText` stands after the item's
 *  current marker, and the text its paragraph keeps: a demoted marker goes back into the text. */
function splitTaskLine(
	meta: Readonly<ListItemMetadata>,
	firstLineText: string
): { match: ReturnType<typeof matchTaskCheckbox>; kept: string } {
	const line = (meta.taskMarker ?? '') + firstLineText;
	const match = matchTaskCheckbox(line);
	if (match) return { match, kept: line.slice(match.rawMarker.length) };
	const demoted = meta.taskItem === true || meta.taskMarker !== null;
	return { match: null, kept: demoted ? line : firstLineText };
}

/** The first line of `raw` without its ending. */
function firstLineTextOf(raw: string): string {
	const end = raw.indexOf('\n');
	return trimTrailingLineEnding(end === -1 ? raw : raw.slice(0, end + 1));
}

/** The marker's bytes move between the item's metadata and its first child, so that child is
 *  copied out of the undo snapshot before it is written (`unshare.ts` header). */
function ownedFirstChild(listItem: CstNode, sharing: SharingState): CstNode {
	return ensureUnsharedChild(listItem, 0, sharing);
}

// ── Where a caret lands in re-read blocks ────────────────────────────────────

/** The blocks' bytes as one run, the first block's separator left out. */
function bytesOf(nodes: readonly NodeView[]): string {
	return nodes.map((node, i) => (i === 0 ? '' : node.leadingTrivia) + node.raw).join('');
}

/** The byte a caret at `offset` in block `index` stands before, counted over all the blocks. */
function byteAt(nodes: readonly NodeView[], index: number, offset: number): number {
	const before = bytesOf(nodes.slice(0, index)).length;
	const node = nodes[index];
	const separator = index === 0 ? 0 : node.leadingTrivia.length;
	const end = trimTrailingLineEnding(node.raw).length;
	return before + separator + (offset === CURSOR_END ? end : Math.min(offset, end));
}

/** The block and offset holding byte `at`; a byte on a boundary stays in the earlier block. */
function caretIn(nodes: readonly NodeView[], at: number): { index: number; offset: number } {
	let start = 0;
	for (let i = 0; i < nodes.length; i++) {
		if (i > 0) start += nodes[i].leadingTrivia.length;
		const end = start + trimTrailingLineEnding(nodes[i].raw).length;
		if (at <= end || i === nodes.length - 1) return { index: i, offset: Math.max(at - start, 0) };
		start += nodes[i].raw.length;
	}
	return { index: 0, offset: 0 };
}
