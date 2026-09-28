/**
 * Replacement node list for a multi-block paste into a single leaf: the leaf's raw split
 * at the cursor, with the pasted blocks between the slices. Structural pastes only: routing
 * a single-paragraph clipboard here would split it into three nodes.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { ownTrailingLineEnding, trailingLineEnding, type LineEnding } from '../../core/lines';
import { isBlankParagraph } from '../../core/parser';
import { ensureEditableContainers } from '../node-primitives';
import { parseCutResidue, parseFirstBlock } from '../parse-block';
import { cutKeepingStructure } from '../structural-suffix';
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
	ending: LineEnding,
	grammar: GrammarView
): PastedReplacement {
	if (blocks.length === 0) return { nodes: [], lastPastedIndex: -1 };

	const leafRaw = leaf.raw;
	const lineEnding = trailingLineEnding(leafRaw, ending);
	const { head: rawBefore, rest } = cutKeepingStructure(leaf, offset);
	const residue = parseCutResidue(rest, lineEnding, grammar);
	const originalTrivia = leaf.leadingTrivia ?? '';

	const newNodes: CstNode[] = [];

	// Re-parsed so heading/list leaves round-trip through their own parser rather than
	// being forced back to a paragraph.
	if (rawBefore.length > 0) {
		const beforeRaw = rawBefore + lineEnding;
		const beforeNode = parseFirstBlock(beforeRaw, grammar);
		beforeNode.leadingTrivia = originalTrivia;
		ensureEditableContainers(beforeNode, lineEnding);
		newNodes.push(beforeNode);
	}

	const hasResidue = residue.blocks.length > 0;
	const landed = landClipboardBlocks(newNodes.at(-1), blocks, lineEnding);
	if (newNodes.length === 0) landed[0].leadingTrivia = originalTrivia;
	// Appended, never spread: a paste can outnumber an argument list (G4.60).
	for (const node of landed) newNodes.push(node);
	const lastPastedIndex = newNodes.length - 1;

	if (hasResidue) {
		const [first, ...rest] = residue.blocks;
		const lastPasted = newNodes[lastPastedIndex];
		// An open last pasted block sits on the cut line, so the rest of that line, blank or just its
		// break, ends it; a closed one is followed by the cut line's break as a blank line.
		const onCutLine = ownTrailingLineEnding(lastPasted.raw) === '';
		const blankTail = !residue.endedLine && rest.length === 0 && isBlankParagraph(first);
		const cutLineEnd = residue.endedLine || (onCutLine && blankTail ? first.raw : lineEnding);
		if (onCutLine) newNodes[lastPastedIndex] = endedOnCutLine(lastPasted, cutLineEnd, grammar);
		if (!onCutLine || !blankTail) {
			newNodes.push({ ...first, leadingTrivia: onCutLine ? '' : cutLineEnd });
		}
		for (const node of rest) newNodes.push(node);
		for (let i = lastPastedIndex + 1; i < newNodes.length; i++) {
			ensureEditableContainers(newNodes[i], lineEnding);
		}
	}

	return { nodes: newNodes, lastPastedIndex };
}

/** `node` with the rest of the line it was pasted into, read back as the one block it still is. */
function endedOnCutLine(node: CstNode, cutLineEnd: string, grammar: GrammarView): CstNode {
	const lineEnding = trailingLineEnding(cutLineEnd, '\n');
	const ended = parseFirstBlock(node.raw + cutLineEnd, grammar);
	ended.leadingTrivia = node.leadingTrivia;
	ensureEditableContainers(ended, lineEnding);
	return ended;
}

/** The clipboard's blocks as they land after `prev`; the commit ends the last one's line. */
export function landClipboardBlocks(
	prev: CstNode | undefined,
	blocks: readonly CstNode[],
	lineEnding: '\n' | '\r\n'
): CstNode[] {
	const landed: CstNode[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const before = landed[landed.length - 1] ?? prev;
		const node = before ? landedAfter(before, blocks[i], lineEnding) : { ...blocks[i] };
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
