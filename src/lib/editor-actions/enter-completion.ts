/**
 * The split command's Enter-completion arm: a lone typed line a registered completer claims
 * becomes the structure it opens instead of splitting. Pure — `split` owns the mutation.
 */

import { parse } from '../core/parser';
import { displayLength, splitLines, trailingLineEnding } from '../core/lines';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { completeTypedLine, type CompletionResult } from '../schema/block-completions';

export interface EnterCompletion {
	replacement: CstNode[];
	caret: { path: number[]; offset: number };
}

/** The completion a press at `offset` earns, or null when the block or the caret disqualifies it. */
export function planEnterCompletion(
	node: NodeView | undefined,
	offset: number
): EnterCompletion | null {
	if (!node) return null;
	const line = wholeTypedLine(node);
	if (line === null || offset !== displayLength(node.raw)) return null;
	const claim = completeTypedLine(line);
	if (!claim) return null;

	// Through the parser rather than a hand-built node, so the mint is exactly what a reload of
	// those bytes produces. Global grammar, as every other structural reparse.
	const lineEnding = trailingLineEnding(node.raw);
	const raw = claim.lines.map((text) => text + lineEnding).join('');
	const replacement = parse(raw, { scope: 'fragment' }).children;
	// An all-blank mint would replace the block with nothing, which is a delete, not a completion.
	if (replacement.length === 0) return null;
	return { replacement, caret: resolveCaret(replacement[0], claim.caret) };
}

/** The claim's line/column as a byte offset inside the node its path addresses. Resolved here
 *  because the line ending the count depends on is the seam's choice, not the completer's. */
function resolveCaret(minted: CstNode, caret: CompletionResult['caret']) {
	let target: CstNode | undefined = minted;
	for (const index of caret.path) target = target?.children?.[index];
	const lines = target ? splitLines(target.raw) : [];
	return { path: caret.path, offset: (lines[caret.line]?.start ?? 0) + caret.column };
}

/** The one line this block's raw is, or null when it is not a single line of prose whose every
 *  byte is content — a completer must never read a kind's own markers as typed text. */
function wholeTypedLine(node: NodeView): string | null {
	const descriptor = getBlockKindDescriptor(node.kind);
	if (descriptor.mergeRole !== 'prose') return null;
	const lines = splitLines(node.raw);
	if (lines.length !== 1) return null;
	const content = descriptor.getContentRange?.(node);
	if (content && (content.start !== 0 || content.end !== displayLength(node.raw))) return null;
	return lines[0].text;
}
