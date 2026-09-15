/**
 * Enter completion: a lone typed line a registered completer recognises becomes the structure
 * it opens instead of splitting. `planEnterCompletion` is pure; `withEnterCompletion` is the
 * one place the plan is applied, wrapped around a composed `splitBlock`.
 */

import { parse } from '../core/parser';
import { displayLength, splitLines, trailingLineEnding } from '../core/lines';
import type { BlockEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import {
	completeLineOnType,
	completeTypedLine,
	type CompletionResult
} from '../schema/block-completions';

export interface EnterCompletion {
	replacement: CstNode[];
	caret: { path: number[]; offset: number };
}

/**
 * Wraps a composed `splitBlock` with the completer check, at the two bundle composition sites
 * only. Above the container overrides rather than inside the split, so a container that
 * replaces `splitBlock` cannot lose the completion for its subtree. One Enter checks once per
 * node: the blockquote exit's call into the parent is a second check on a different node,
 * which always declines, since a container is never a prose line.
 */
export function withEnterCompletion(
	blockEdit: BlockEditActions,
	childAt: (index: number) => NodeView | undefined
): BlockEditActions {
	return {
		...blockEdit,
		async splitBlock(index: number, offset: number): Promise<void> {
			const completion = planEnterCompletion(childAt(index), offset);
			if (!completion) {
				await blockEdit.splitBlock(index, offset);
				return;
			}
			// `snapshotOffset` is where the caret was, so one undo restores the typed line with the
			// caret at its end rather than in front of it.
			await blockEdit.replaceBlock(
				index,
				completion.replacement,
				{ replacementIndex: 0, ...completion.caret },
				{ snapshotOffset: offset }
			);
		},
		// The typing side: a keystroke that leaves the block as a line an on-type completer
		// recognises (`BlockCompleter.onType`) forms the structure at once, the way a typed
		// ` ``` ` is a fence the moment the parser sees it. The write lands first, so the typed
		// line is its own undo step and the replacement covers the bytes the CST actually holds.
		async updateBlockContent(index, text, preEditOffset, postEditFocusOffset) {
			await blockEdit.updateBlockContent(index, text, preEditOffset, postEditFocusOffset);
			const offset = postEditFocusOffset ?? preEditOffset;
			if (offset === undefined) return;
			const completion = planTypedCompletion(childAt(index), offset);
			if (!completion) return;
			await blockEdit.replaceBlock(
				index,
				completion.replacement,
				{ replacementIndex: 0, ...completion.caret },
				{ snapshotOffset: offset }
			);
		}
	};
}

/** The completion Enter at `offset` produces, or null when the block or the caret rules it out. */
export function planEnterCompletion(
	node: NodeView | undefined,
	offset: number
): EnterCompletion | null {
	return planCompletion(node, offset, completeTypedLine);
}

/** The completion a keystroke produces, asking only the completers that answer on type. */
export function planTypedCompletion(
	node: NodeView | undefined,
	offset: number
): EnterCompletion | null {
	return planCompletion(node, offset, completeLineOnType);
}

function planCompletion(
	node: NodeView | undefined,
	offset: number,
	consult: (line: string) => CompletionResult | null
): EnterCompletion | null {
	if (!node) return null;
	const line = wholeTypedLine(node);
	if (line === null || offset !== displayLength(node.raw)) return null;
	const claim = consult(line);
	if (!claim) return null;

	// Through the parser rather than a hand-built node, so the new blocks are exactly what a
	// reload of those bytes produces. Global grammar, like every other structural reparse.
	const lineEnding = trailingLineEnding(node.raw);
	const raw = claim.lines.map((text) => text + lineEnding).join('');
	const replacement = parse(raw, { scope: 'fragment' }).children;
	// A completion that shows nothing would replace the typed line with a delete, or with blank
	// lines a reload reads as neither. Blank lines parse back as empty paragraphs, so the check
	// is per node rather than by child count.
	if (replacement.every((node) => node.raw.trim() === '')) return null;
	return { replacement, caret: resolveCaret(replacement[0], claim.caret) };
}

/** The completer's line and column as a byte offset inside the node its path addresses. Resolved
 *  here because the line ending the count depends on is chosen here, not by the completer. */
function resolveCaret(minted: CstNode, caret: CompletionResult['caret']) {
	let target: CstNode | undefined = minted;
	for (const index of caret.path) target = target?.children?.[index];
	const lines = target ? splitLines(target.raw) : [];
	return { path: caret.path, offset: (lines[caret.line]?.start ?? 0) + caret.column };
}

/** The one line this block's raw is, or null when it is not a single line of prose whose every
 *  byte is content: a completer must never read a kind's own markers as typed text. */
function wholeTypedLine(node: NodeView): string | null {
	const descriptor = getBlockKindDescriptor(node.kind);
	if (descriptor.mergeRole !== 'prose') return null;
	const lines = splitLines(node.raw);
	if (lines.length !== 1) return null;
	const content = descriptor.getContentRange?.(node);
	if (content && (content.start !== 0 || content.end !== displayLength(node.raw))) return null;
	return lines[0].text;
}
