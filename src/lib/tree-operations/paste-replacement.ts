/**
 * Build the replacement node list for a multi-block paste into a single
 * leaf block. Splits the leaf's raw at the cursor offset, merges the
 * leading slice with the first pasted block and the trailing slice with
 * the last, leaving the middle blocks intact. Returns the new nodes
 * ready to splice in at the leaf's index inside its parent's children.
 *
 * Leaf-agnostic: works identically at document top-level and inside any
 * container (list item, blockquote). Callers are responsible for the
 * id / ref / ancestry-rebuild ceremony — this helper is pure CST.
 */

import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { trimTrailingLineEnding } from '../core/lines';
import { parseAllInlineContent } from '../core/inline';
import { ensureEditableContainers } from './node-ops';

export function buildPastedReplacement(
	leaf: CstNode,
	offset: number,
	blocks: CstNode[]
): CstNode[] {
	if (blocks.length === 0) return [];

	const leafRaw = leaf.raw;
	const lineEnding = leafRaw.endsWith('\r\n') ? '\r\n' : '\n';
	const rawBefore = leafRaw.slice(0, offset);
	const rawAfter = trimTrailingLineEnding(leafRaw.slice(offset));
	const originalTrivia = leaf.leadingTrivia ?? '';

	const newNodes: CstNode[] = [];

	// Leading slice — re-parse so a leaf whose kind is heading/list/etc.
	// round-trips through its own parser rather than being forced back to
	// a paragraph. Empty slice means no leading node.
	if (rawBefore.length > 0) {
		const beforeRaw = rawBefore + lineEnding;
		const beforeDoc = parse(beforeRaw);
		const beforeNode =
			beforeDoc.children.length > 0
				? beforeDoc.children[0]
				: { kind: 'paragraph' as const, leadingTrivia: '', raw: beforeRaw };
		beforeNode.leadingTrivia = originalTrivia;
		ensureEditableContainers(beforeNode);
		newNodes.push(beforeNode);
	}

	// Middle pasted blocks untouched except for leadingTrivia normalization:
	// the first node placed receives the leaf's original trivia, subsequent
	// nodes keep their own (or empty).
	for (let i = 0; i < blocks.length - 1; i++) {
		const node = { ...blocks[i] };
		node.leadingTrivia = newNodes.length === 0 ? originalTrivia : (node.leadingTrivia ?? '');
		ensureEditableContainers(node);
		newNodes.push(node);
	}

	// Trailing slice merged onto the final pasted block so post-caret text
	// survives the splice at the correct end-of-paste location.
	const lastPasted = blocks[blocks.length - 1];
	const mergedLastRaw = trimTrailingLineEnding(lastPasted.raw) + rawAfter + lineEnding;
	const lastDoc = parse(mergedLastRaw);
	const lastNode =
		lastDoc.children.length > 0
			? lastDoc.children[0]
			: { kind: 'paragraph' as const, leadingTrivia: '', raw: mergedLastRaw };
	// Preserve the copied block's leadingTrivia when not-first-placed — it
	// encodes the blank line separating this block from the previous source
	// block, and dropping it would collapse "a\n\nb" into "a\nb" on paste.
	lastNode.leadingTrivia =
		newNodes.length === 0 ? originalTrivia : (lastPasted.leadingTrivia ?? '');
	ensureEditableContainers(lastNode);
	newNodes.push(lastNode);

	parseAllInlineContent(newNodes);
	return newNodes;
}
