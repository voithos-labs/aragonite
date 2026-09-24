/**
 * Replacement node list for a multi-block paste into a single leaf: the leaf's raw split
 * at the cursor, with the pasted blocks between the slices. Structural pastes only: routing
 * a single-paragraph clipboard here would split it into three nodes.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import {
	ownTrailingLineEnding,
	snapToScalarBoundary,
	trailingLineEnding,
	trimTrailingLineEnding
} from '../../core/lines';
import { isBlankParagraph } from '../../core/parser';
import { ensureEditableContainers } from '../node-primitives';
import { parseCutResidue, parseFirstBlock } from '../parse-block';
import { terminateLastLine } from '../list/terminator';
import type { GrammarView } from '../../schema/block-openers';

export interface PastedReplacement {
	nodes: CstNode[];
	/** Index of the last pasted block in `nodes`, where the caret lands. */
	lastPastedIndex: number;
}

export function buildPastedReplacement(
	leaf: NodeView,
	offset: number,
	blocks: CstNode[],
	grammar?: GrammarView
): PastedReplacement {
	if (blocks.length === 0) return { nodes: [], lastPastedIndex: -1 };

	const leafRaw = leaf.raw;
	const lineEnding = trailingLineEnding(leafRaw);
	const display = trimTrailingLineEnding(leafRaw);
	// Moved off the middle of a surrogate pair before the cut: the halves land in different
	// blocks, so a pair split here is unrecoverable bytes rather than a recoverable edit.
	const cut = snapToScalarBoundary(display, offset);
	const rawBefore = display.slice(0, cut);
	const residue = parseCutResidue(display.slice(cut), lineEnding, grammar);
	const originalTrivia = leaf.leadingTrivia ?? '';

	const newNodes: CstNode[] = [];

	// Re-parsed so heading/list leaves round-trip through their own parser rather than
	// being forced back to a paragraph.
	if (rawBefore.length > 0) {
		const beforeRaw = rawBefore + lineEnding;
		const beforeNode = parseFirstBlock(beforeRaw, grammar);
		beforeNode.leadingTrivia = originalTrivia;
		ensureEditableContainers(beforeNode);
		newNodes.push(beforeNode);
	}

	// With none of the leaf after it, the last pasted block ends where the leaf ended.
	const hasResidue = residue.blocks.length > 0;
	const closesLine = !hasResidue && ownTrailingLineEnding(leafRaw) !== '';
	const landed = landClipboardBlocks(newNodes.at(-1), blocks, lineEnding, closesLine);
	if (newNodes.length === 0) landed[0].leadingTrivia = originalTrivia;
	// Appended, never spread: a paste can outnumber an argument list (G4.60).
	for (const node of landed) newNodes.push(node);
	const lastPastedIndex = newNodes.length - 1;

	// Separate blocks rather than merged into the last pasted block, which would let a
	// non-paragraph tail absorb them as continuation lines. A cut at a line's end hands the
	// residue that line's own break.
	if (hasResidue) {
		const [first, ...rest] = residue.blocks;
		newNodes.push({ ...first, leadingTrivia: residue.endedLine || lineEnding });
		for (const node of rest) newNodes.push(node);
		for (let i = lastPastedIndex + 1; i < newNodes.length; i++) {
			ensureEditableContainers(newNodes[i]);
		}
	}

	return { nodes: newNodes, lastPastedIndex };
}

/**
 * The clipboard's blocks as they land after `prev`: each apart from the block before it, each
 * container given an editable child, and the last one ending its line when `closesLine` says
 * none of the target's text continues it. Left open, it would take the next block's blank line.
 */
export function landClipboardBlocks(
	prev: CstNode | undefined,
	blocks: readonly CstNode[],
	lineEnding: '\n' | '\r\n',
	closesLine: boolean
): CstNode[] {
	const landed: CstNode[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const before = landed[landed.length - 1] ?? prev;
		const node = before ? landedAfter(before, blocks[i], lineEnding) : { ...blocks[i] };
		// Ahead of the backfill: an empty container keeps its own bytes and gains the ending.
		if (closesLine && i === blocks.length - 1) terminateLastLine(node, lineEnding);
		ensureEditableContainers(node);
		landed.push(node);
	}
	return landed;
}

/**
 * A copy of `block` as it lands after `prev`, with a blank line of its own where the clipboard
 * gave it none: without one it would continue `prev` on reload. A blank `prev` already holds
 * the run open, so the block keeps what it has.
 */
export function landedAfter(prev: CstNode, block: CstNode, lineEnding: '\n' | '\r\n'): CstNode {
	const separated = block.leadingTrivia !== '' || isBlankParagraph(prev);
	return { ...block, leadingTrivia: separated ? block.leadingTrivia : lineEnding };
}
