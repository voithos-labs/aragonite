/**
 * Build the replacement node list for a multi-block paste into a single
 * leaf block. Splits the leaf's raw at the cursor offset and produces:
 *
 *   [optional leading-slice node, ...pastedBlocks, optional trailing-slice node]
 *
 * Each pasted block keeps its source leadingTrivia where it carries a
 * meaningful blank-line separator, otherwise it inherits the parent
 * paragraph break so the structural blocks render as distinct paragraphs
 * rather than collapsing into the leading slice via a soft line break.
 *
 * Leaf-agnostic: works identically at document top-level and inside any
 * container (list item, blockquote). Callers handle id / ref / ancestry
 * rebuilds — this helper is pure CST.
 *
 * Only invoked for STRUCTURAL pastes (multi-block clipboard, or single
 * non-paragraph block). Single-paragraph clipboards take the inline raw-
 * splice path in their respective callers; routing them here would split
 * a one-paragraph paste into three nodes when the user expected one.
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
	const display = trimTrailingLineEnding(leafRaw);
	const rawBefore = display.slice(0, offset);
	const rawAfter = display.slice(offset);
	const originalTrivia = leaf.leadingTrivia ?? '';

	const newNodes: CstNode[] = [];

	// Leading slice — re-parse so a leaf whose kind is heading/list/etc.
	// round-trips through its own parser rather than being forced back to
	// a paragraph. Empty slice (cursor at start) means no leading node.
	if (rawBefore.length > 0) {
		const beforeRaw = rawBefore + lineEnding;
		const beforeNode = parseFirstBlock(beforeRaw);
		beforeNode.leadingTrivia = originalTrivia;
		ensureEditableContainers(beforeNode);
		newNodes.push(beforeNode);
	}

	// Pasted blocks — first-placed inherits the leaf's original trivia;
	// subsequent pasted blocks force a blank-line separator when their
	// source trivia is empty. The empty case happens for the FIRST block
	// of the parsed clipboard (no preceding content in the clipboard);
	// without the override, that block butts up against the leading slice
	// via a soft line break and the user sees one merged paragraph.
	for (let i = 0; i < blocks.length; i++) {
		const node = { ...blocks[i] };
		if (newNodes.length === 0) {
			node.leadingTrivia = originalTrivia;
		} else {
			node.leadingTrivia = blocks[i].leadingTrivia ? blocks[i].leadingTrivia : lineEnding;
		}
		ensureEditableContainers(node);
		newNodes.push(node);
	}

	// Trailing slice — separate node, NOT merged into the last pasted
	// block. Merging produced soft-break artifacts ("two\nafter" parses as
	// one paragraph with a soft line break) and worse for non-paragraph
	// last blocks (a list whose last item absorbs the trailing text as a
	// continuation line). A separate paragraph is the conservative choice.
	if (rawAfter.length > 0) {
		const afterRaw = rawAfter + lineEnding;
		const afterNode = parseFirstBlock(afterRaw);
		afterNode.leadingTrivia = lineEnding;
		ensureEditableContainers(afterNode);
		newNodes.push(afterNode);
	}

	parseAllInlineContent(newNodes);
	return newNodes;
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Parse a raw fragment and return its first block, or a fallback paragraph
 * carrying the raw verbatim when the parser produced nothing.
 */
function parseFirstBlock(raw: string): CstNode {
	const doc = parse(raw);
	if (doc.children.length > 0) return doc.children[0];
	return { kind: 'paragraph', leadingTrivia: '', raw };
}
