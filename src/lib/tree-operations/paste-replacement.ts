/**
 * Replacement node list for a multi-block paste into a single leaf: the leaf's raw split
 * at the cursor, with the pasted blocks between the slices. STRUCTURAL pastes only —
 * routing a single-paragraph clipboard here would split it into three nodes.
 */

import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { ensureEditableContainers } from './node-ops';
import { parseFirstBlock } from './parse-block';

export function buildPastedReplacement(
	leaf: NodeView,
	offset: number,
	blocks: CstNode[]
): CstNode[] {
	if (blocks.length === 0) return [];

	const leafRaw = leaf.raw;
	const lineEnding = trailingLineEnding(leafRaw);
	const display = trimTrailingLineEnding(leafRaw);
	const rawBefore = display.slice(0, offset);
	const rawAfter = display.slice(offset);
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
	// against its predecessor via a soft break and renders as one merged paragraph. An
	// empty paragraph IS the separator, so it and its successor skip the override.
	for (let i = 0; i < blocks.length; i++) {
		const node = { ...blocks[i] };
		const prev = newNodes[newNodes.length - 1];
		const prevIsEmptyParagraph = prev !== undefined && isEmptyParagraphNode(prev);
		if (newNodes.length === 0) {
			node.leadingTrivia = originalTrivia;
		} else if (isEmptyParagraphNode(blocks[i]) || prevIsEmptyParagraph) {
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

// ── Internal ───────────────────────────────────────────────────────────────

/** A paragraph containing only a line ending — its own blank-line separator. */
function isEmptyParagraphNode(node: CstNode): boolean {
	if (node.kind !== 'paragraph') return false;
	return node.raw === '' || node.raw === '\n' || node.raw === '\r\n';
}
