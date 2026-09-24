import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';

/** Parse one block's `raw` in the editor's grammar and return its first block, falling back to a
 *  paragraph node. */
export function parseFirstBlock(raw: string, grammar?: GrammarView): CstNode {
	const doc = parse(raw, { grammar, scope: 'fragment' });
	if (doc.children.length > 0) return doc.children[0];
	return { kind: 'paragraph', leadingTrivia: '', raw };
}
