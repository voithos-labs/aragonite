/**
 * Replacement node list for a multi-block paste into a single leaf: the leaf's raw split
 * at the cursor, with the pasted blocks between the slices. STRUCTURAL pastes only —
 * routing a single-paragraph clipboard here would split it into three nodes.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { snapToScalarBoundary, trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { isBlankParagraph } from '../../core/parser';
import { ensureEditableContainers } from '../node-ops';
import { parseFirstBlock } from '../parse-block';

export function buildPastedReplacement(
	leaf: NodeView,
	offset: number,
	blocks: CstNode[]
): CstNode[] {
	if (blocks.length === 0) return [];

	const leafRaw = leaf.raw;
	const lineEnding = trailingLineEnding(leafRaw);
	const display = trimTrailingLineEnding(leafRaw);
	// Off any scalar interior before the cut: the halves land in DIFFERENT blocks, so a pair
	// split here is unrecoverable bytes rather than a recoverable edit.
	const cut = snapToScalarBoundary(display, offset);
	const rawBefore = display.slice(0, cut);
	const rawAfter = display.slice(cut);
	const originalTrivia = leaf.leadingTrivia ?? '';

	const newNodes: CstNode[] = [];

	// Re-parsed so heading/list leaves round-trip through their own parser rather than
	// being forced back to a paragraph.
	if (rawBefore.length > 0) {
		const beforeRaw = rawBefore + lineEnding;
		const beforeNode = parseFirstBlock(beforeRaw);
		beforeNode.leadingTrivia = originalTrivia;
		ensureEditableContainers(beforeNode);
		newNodes.push(beforeNode);
	}

	// A blank-line separator is forced where source trivia is empty, or the block butts
	// against its predecessor via a soft break and renders as one merged paragraph. A blank
	// predecessor already holds a run open, so its successor takes no separator of its own.
	for (let i = 0; i < blocks.length; i++) {
		const node = { ...blocks[i] };
		const prev = newNodes[newNodes.length - 1];
		if (newNodes.length === 0) {
			node.leadingTrivia = originalTrivia;
		} else if (prev !== undefined && isBlankParagraph(prev)) {
			node.leadingTrivia = blocks[i].leadingTrivia ?? '';
		} else {
			node.leadingTrivia = blocks[i].leadingTrivia ? blocks[i].leadingTrivia : lineEnding;
		}
		ensureEditableContainers(node);
		newNodes.push(node);
	}

	// Separate node rather than merged into the last pasted block, which would let a
	// non-paragraph tail absorb it as a continuation line.
	if (rawAfter.length > 0) {
		const afterRaw = rawAfter + lineEnding;
		const afterNode = parseFirstBlock(afterRaw);
		afterNode.leadingTrivia = lineEnding;
		ensureEditableContainers(afterNode);
		newNodes.push(afterNode);
	}

	return newNodes;
}
