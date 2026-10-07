/**
 * Enter completion: a lone typed line a registered completer recognises becomes the structure
 * it opens instead of splitting. `planEnterCompletion` is pure; `withEnterCompletion` is the
 * one place a plan is applied, on Enter and, for the completers that answer as you type, after
 * a keystroke's write.
 */

import { readBlocks } from '../core/parser';
import {
	displayLength,
	isBlankText,
	splitLines,
	trailingLineEnding,
	type LineEnding
} from '../core/lines';
import type { BlockEditActions } from '../action-contracts';
import type { CommandRun } from '../schema/block-commands';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { GrammarView } from '../schema/block-openers';
import {
	completeLineOnType,
	completeTypedLine,
	type CompletionResult
} from '../schema/block-completions';

export interface EnterCompletion {
	replacement: CstNode[];
	caret: { path: number[]; offset: number };
}

/** Adds the completer check to a composed `splitBlock`, and the on-type completion, above the
 *  container overrides so a container replacing `splitBlock` keeps the completion for its subtree. */
export function withEnterCompletion(
	blockEdit: Omit<BlockEditActions, 'completeLineOnType'>,
	childAt: (index: number) => NodeView | undefined,
	grammar: GrammarView,
	getLineEnding: () => LineEnding
): BlockEditActions {
	/** `snapshotOffset` is where the caret was, so one undo restores the typed line with the caret
	 *  at its end rather than in front of it. */
	const complete = (index: number, completion: EnterCompletion, snapshotOffset: number) =>
		blockEdit.replaceBlock(
			index,
			completion.replacement,
			{ replacementIndex: 0, ...completion.caret },
			{ snapshotOffset }
		);
	return {
		...blockEdit,
		async splitBlock(index: number, offset: number, run?: CommandRun): Promise<boolean> {
			const completion = planEnterCompletion(childAt(index), offset, grammar, getLineEnding());
			if (!completion) return blockEdit.splitBlock(index, offset, run);
			return complete(index, completion, offset);
		},
		async completeLineOnType(index: number, caret: number): Promise<boolean> {
			const completion = planTypedCompletion(childAt(index), caret, grammar, getLineEnding());
			return completion ? complete(index, completion, caret) : false;
		}
	};
}

/** The completion Enter at `offset` produces, or null when the block or the caret rules it out. */
export function planEnterCompletion(
	node: NodeView | undefined,
	offset: number,
	grammar: GrammarView,
	lineEnding: LineEnding
): EnterCompletion | null {
	return planCompletion(node, offset, grammar, lineEnding, (line) =>
		completeTypedLine(line, grammar)
	);
}

/** The completion a keystroke produces, asking only the completers that answer on type. */
export function planTypedCompletion(
	node: NodeView | undefined,
	offset: number,
	grammar: GrammarView,
	lineEnding: LineEnding
): EnterCompletion | null {
	return planCompletion(node, offset, grammar, lineEnding, (line) =>
		completeLineOnType(line, grammar)
	);
}

/** `ending` is the document's, for a typed line that has none of its own. */
function planCompletion(
	node: NodeView | undefined,
	offset: number,
	grammar: GrammarView,
	ending: LineEnding,
	consult: (line: string) => CompletionResult | null
): EnterCompletion | null {
	if (!node) return null;
	const line = wholeTypedLine(node);
	if (line === null || offset !== displayLength(node.raw)) return null;
	const claim = consult(line);
	if (!claim) return null;

	// Through the parser in the editor's grammar rather than a hand-built node, so the new blocks
	// are exactly what a reload of those bytes produces.
	const lineEnding = trailingLineEnding(node.raw, ending);
	const raw = claim.lines.map((text) => text + lineEnding).join('');
	const replacement = readBlocks(raw, { grammar, scope: 'fragment' }).children;
	// A completion of only blank lines would replace the typed line with a delete; the check is per
	// node because blank lines parse back as empty paragraphs.
	if (replacement.every((node) => isBlankText(node.raw))) return null;
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
