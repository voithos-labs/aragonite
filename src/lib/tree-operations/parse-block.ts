import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';

/** Parse one block's `raw` and return its first block, falling back to a paragraph node. */
export function parseFirstBlock(raw: string): CstNode {
	const doc = parse(raw, { scope: 'fragment' });
	if (doc.children.length > 0) return doc.children[0];
	return { kind: 'paragraph', leadingTrivia: '', raw };
}
