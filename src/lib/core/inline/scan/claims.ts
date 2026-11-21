// What a plugin handler's returned node must satisfy, and the claim stamped on what it built.
import { isBuiltinInlineKind, type InlineNode } from '../../nodes';
import { inlineDescendants } from '../walk';
import type { InlineHandler } from './plugin-syntax';

export function checkClaim(node: InlineNode, prefix: string, pos: number, end: number): void {
	const name = `inline-syntax ${JSON.stringify(prefix)}`;
	if (node.start !== pos) {
		throw new Error(`${name} returned a node starting at ${node.start}, not at its trigger ${pos}`);
	}
	if (!(node.end > pos))
		throw new Error(`${name} returned a node that does not advance past ${pos}`);
	if (node.end > end) {
		throw new Error(`${name} claimed [${node.start}, ${node.end}), past the scan range end ${end}`);
	}
}

/** Marks every built-in node the handler built, so the editor's writers keep its syntax; an
 *  `inline()` construct sets its node's claim itself, its writer bound to the node's data. */
export function stampClaim(node: InlineNode, handler: InlineHandler): void {
	const claim = node.syntaxClaim ?? {
		prefix: handler.prefix,
		...(handler.rewriteImage ? { rewriteImage: handler.rewriteImage } : {})
	};
	for (const inline of inlineDescendants([node])) {
		if (isBuiltinInlineKind(inline.kind)) inline.syntaxClaim = claim;
	}
}
