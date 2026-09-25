/**
 * The bytes a block is replaced by, parsed the one way every replace-at-parent caller needs them:
 * terminated in the original's own line ending (G4.20), reparsed in the instance grammar, carrying
 * the original's leading blank lines, with editable containers ensured.
 */

import type { CstNode } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import { readBlocks } from '../../core/parser';
import { terminateLine } from '../../core/lines';
import { ensureEditableContainers, normalizeReplacementTrivia } from '../node-primitives';

export interface ParsedReplacement {
	replacement: CstNode[];
	/** The parse's own trailing blank, for a caller that lands one (`paste/dispatch.ts`). */
	suffix: string;
}

/**
 * Null where `raw` parses to nothing and the caller named no `fallback`: the block keeps its
 * bytes rather than being replaced by an empty splice.
 */
export function parseReplacement(
	original: CstNode,
	raw: string,
	grammar: GrammarView,
	fallback?: () => CstNode[]
): ParsedReplacement | null {
	const parsed = readBlocks(terminateLine(raw, original.raw), { grammar, scope: 'fragment' });
	const children = parsed.children.length > 0 ? parsed.children : fallback?.();
	if (!children || children.length === 0) return null;
	const replacement = normalizeReplacementTrivia(original, children);
	for (const node of replacement) ensureEditableContainers(node);
	return { replacement, suffix: parsed.suffix };
}
