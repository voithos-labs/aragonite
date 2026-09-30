/**
 * Where paste applies a container's `bodyWrite` escape: paste builds nodes before any content
 * write sees them, so the escape is applied here instead, to the clipboard text before the
 * strategy-picking parse and to the built replacement at the splice.
 */

import type { CstNode, Document } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { documentLineEnding, type LineEnding } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import { readBlocks } from '../../core/parser';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import {
	ensureEditableContainers,
	isBlockNode,
	nodeAt,
	normalizeBodyWrite,
	normalizeReplacementTrivia
} from '../node-primitives';

/** Clipboard text made legal inside every `bodyWrite`-declaring ancestor of the paste target. */
export function normalizeClipboardForBody(
	doc: Document,
	targetPath: number[],
	text: string
): string {
	let out = text;
	const lineEnding = documentLineEnding(doc);
	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, targetPath.slice(0, depth));
		if (ancestor && isBlockNode(ancestor)) out = normalizeBodyWrite(ancestor, out, lineEnding);
	}
	return out;
}

export interface BodyLegalReplacement {
	replacement: CstNode[];
	/** A pre-normalize replacement index, mapped past any escape reparse that grew the list. */
	mapIndex: (index: number) => number;
}

/**
 * Replacement nodes made legal as `owner`'s children. A changed raw reparses whole, so
 * the landed kind follows the escaped bytes and a container's children stay in step.
 */
export function normalizeReplacementForBody(
	owner: NodeView | undefined,
	replacement: CstNode[],
	ending: LineEnding,
	grammar: GrammarView
): BodyLegalReplacement {
	if (owner === undefined || !tryGetBlockKindDescriptor(owner.kind)?.bodyWrite) {
		return { replacement, mapIndex: (i) => i };
	}
	const out: CstNode[] = [];
	const starts: number[] = [];
	for (const node of replacement) {
		starts.push(out.length);
		const escaped = normalizeBodyWrite(owner, node.raw, ending);
		if (escaped === node.raw) {
			out.push(node);
			continue;
		}
		const reparsed = readBlocks(escaped, { grammar, scope: 'fragment' }).children;
		if (reparsed.length === 0) {
			out.push(node);
			continue;
		}
		const carried = normalizeReplacementTrivia(node, reparsed);
		for (const minted of carried) ensureEditableContainers(minted, ending);
		out.push(...carried);
	}
	return {
		replacement: out,
		mapIndex: (i) => (starts.length === 0 ? 0 : (starts[Math.min(i, starts.length - 1)] ?? 0))
	};
}
