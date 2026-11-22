/**
 * The inline parse: `InlineNode[]` with absolute offsets into `raw`, each byte of `[start, end)`
 * in exactly one top-level node. `grammar` is the editor's, so a handler whose plugin it leaves
 * out takes no bytes. See docs/design/inline-parsing.md.
 */
import type { InlineNode } from '../../nodes';
import type { GrammarView } from '../../../schema/block-openers';
import { buildTree } from './build';
import type { LinkReferenceResolver } from './definitions';
import { Scan, specialFinder } from './scan';
import { inlineTable } from './inline-table';

/** Both bounds are checked at runtime: a caller outside the type checker that passes only the
 *  source would get one whole-string text node, wrong output that looks like a result. */
export function readInline(
	raw: string,
	start: number,
	end: number,
	resolver: LinkReferenceResolver | undefined,
	grammar: GrammarView
): InlineNode[] {
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		throw new TypeError('parseInline needs both bounds: call parseInline(src, 0, src.length)');
	}
	if (start >= end) return [];
	// Most keystrokes land in a span with nothing to read, which then costs one search.
	if (specialFinder(raw, end, inlineTable(grammar))(start) < 0)
		return [{ kind: 'text', start, end, text: raw.slice(start, end) }];
	const { tokens, shapes } = new Scan(raw, start, end, resolver, grammar).run();
	return buildTree(raw, tokens, shapes);
}
