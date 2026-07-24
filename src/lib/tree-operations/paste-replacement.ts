/**
 * Build the replacement node list for a multi-block paste into a single
 * leaf. Splits the leaf's raw at the cursor and produces:
 *   [optional leading-slice, ...pastedBlocks, optional trailing-slice]
 *
 * Only invoked for STRUCTURAL pastes. Single-paragraph clipboards take the
 * inline raw-splice path; routing them here would split a one-paragraph
 * paste into three nodes when the user expected one.
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

	// Re-parse the leading slice so heading/list leaves round-trip through
	// their own parser rather than being forced back to a paragraph.
	if (rawBefore.length > 0) {
		const beforeRaw = rawBefore + lineEnding;
		const beforeNode = parseFirstBlock(beforeRaw);
		beforeNode.leadingTrivia = originalTrivia;
		ensureEditableContainers(beforeNode);
		newNodes.push(beforeNode);
	}

	// First-placed inherits the leaf's original trivia. Subsequent blocks
	// force a blank-line separator when their source trivia is empty —
	// without it, the first clipboard block butts against the leading
	// slice via a soft line break and renders as one merged paragraph.
	// Empty paragraphs ARE themselves the separator; skip the override
	// for them (and for blocks immediately after one).
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

	// Trailing slice stays a separate node — merging into the last pasted
	// block produced soft-break artifacts and worse for non-paragraph tails
	// (a list whose last item absorbs trailing text as a continuation line).
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
