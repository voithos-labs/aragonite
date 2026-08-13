/**
 * The paste family's `bodyWrite` moment: paste builds nodes upstream of every
 * node-ops byte sink, so a container's escape lands here instead — on the clipboard text
 * ahead of the strategy-picking parse, and on the built replacement at the splice.
 */

import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import { parse } from '../../core/parser';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import {
	ensureEditableContainers,
	isBlockNode,
	nodeAt,
	normalizeBodyWrite,
	normalizeReplacementTrivia
} from '../node-ops';

/** Clipboard text made legal inside every `bodyWrite`-declaring ancestor of the paste target. */
export function normalizeClipboardForBody(
	doc: Document,
	targetPath: number[],
	text: string
): string {
	let out = text;
	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, targetPath.slice(0, depth));
		if (ancestor && isBlockNode(ancestor)) out = normalizeBodyWrite(ancestor.kind, out);
	}
	return out;
}

export interface BodyLegalReplacement {
	replacement: CstNode[];
	/** A pre-normalize replacement index, mapped past any escape reparse that grew the list. */
	mapIndex: (index: number) => number;
}

/**
 * Replacement nodes made legal as `ownerKind` children. A changed raw reparses whole, so
 * the landed kind follows the escaped bytes and a container's children stay in step.
 */
export function normalizeReplacementForBody(
	ownerKind: AnyBlockKind | undefined,
	replacement: CstNode[],
	grammar?: GrammarView
): BodyLegalReplacement {
	if (ownerKind === undefined || !tryGetBlockKindDescriptor(ownerKind)?.bodyWrite) {
		return { replacement, mapIndex: (i) => i };
	}
	const out: CstNode[] = [];
	const starts: number[] = [];
	for (const node of replacement) {
		starts.push(out.length);
		const escaped = normalizeBodyWrite(ownerKind, node.raw);
		if (escaped === node.raw) {
			out.push(node);
			continue;
		}
		const reparsed = parse(escaped, {
			scope: 'fragment',
			...(grammar ? { grammar } : {})
		}).children;
		if (reparsed.length === 0) {
			out.push(node);
			continue;
		}
		const carried = normalizeReplacementTrivia(node, reparsed);
		for (const minted of carried) ensureEditableContainers(minted);
		out.push(...carried);
	}
	return {
		replacement: out,
		mapIndex: (i) => (starts.length === 0 ? 0 : (starts[Math.min(i, starts.length - 1)] ?? 0))
	};
}
