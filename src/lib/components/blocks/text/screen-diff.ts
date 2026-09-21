/**
 * What a live rewrite says it did to the screen, as two checks over the text before and after
 * (live-mode.md § 2), plus the single-prose-block reparse a candidate must survive first.
 * Shared, so every caller asks the same questions of the same shapes instead of writing its own
 * traversal.
 */

import { getContentRange, isProseKind, parseInline } from '../../../core/inline';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import type { CstNode, InlineNode } from '../../../core/nodes';
import { parse } from '../../../core/parser';

/** Whether `after` is `before` with `text` spliced in at one place and nothing else moved. */
export function insertsExactly(before: string, after: string, text: string): boolean {
	if (after.length !== before.length + text.length) return false;
	let at = 0;
	while (at < before.length && before[at] === after[at]) at++;
	return (
		after.slice(at, at + text.length) === text && after.slice(at + text.length) === before.slice(at)
	);
}

/** Whether `after` is `before` with exactly `removed` gone from one place: everything a cut
 *  promises the user, asked of the bytes the parser produced rather than the ones it was given. */
export function removesExactly(before: string, after: string, removed: string): boolean {
	if (after.length !== before.length - removed.length) return false;
	let at = 0;
	while (at < after.length && before[at] === after[at]) at++;
	return (
		before.slice(at, at + removed.length) === removed &&
		after.slice(at) === before.slice(at + removed.length)
	);
}

/** The check a candidate must pass: its bytes reparse as exactly one prose block, whose inline
 *  tree the caller then runs its own test over. Null refuses, because a reparse that splits the
 *  block or changes its kind is not what the caller is about to install. */
export function soleProseReparse(
	raw: string,
	resolver?: LinkReferenceResolver
): { block: CstNode; nodes: InlineNode[] } | null {
	const blocks = parse(raw, { scope: 'fragment' }).children;
	if (blocks.length !== 1 || !isProseKind(blocks[0].kind)) return null;
	const block = blocks[0];
	const range = getContentRange(block);
	return { block, nodes: parseInline(block.raw, range.start, range.end, resolver) };
}
