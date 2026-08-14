/**
 * The oracles live-mode.md § 2's license is checked with: what a rewrite may drop, and the residue
 * § 4.1 forbids it from minting. Shared by the split and join property nets and the gesture fuzzer,
 * so one reading of the license answers for all three.
 */

import { constructContentRange, parseInline } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { getInlineConstructPolicy } from '$lib/schema/inline-construct-policy';

/**
 * The residue § 4.1 forbids, in one block's content: a construct whose row declares
 * `autoUnwrapOnEmpty` standing over nothing. Off the parse and the table rather than a delimiter
 * spelling, so every row answers for itself and two legitimate runs meeting are not residue.
 */
export function emptyConstructSpans(
	raw: string,
	content: { start: number; end: number }
): { start: number; end: number }[] {
	const spans: { start: number; end: number }[] = [];
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			// Null content is the emptied pair itself, not a missing answer: `[](u)` has delimiters
			// and nothing between them, which is the shape the column speaks to.
			const range = constructContentRange(node);
			if (
				node.kind !== 'text' &&
				node.end > node.start &&
				(range === null || range.start === range.end) &&
				getInlineConstructPolicy(node.kind)?.autoUnwrapOnEmpty === true
			) {
				spans.push({ start: node.start, end: node.end });
			}
			if (node.children) visit(node.children);
		}
	};
	visit(parseInline(raw, content.start, content.end));
	return spans;
}

/**
 * Whether `inner` can be read off `outer` by deleting characters — the shape of a rewrite that only
 * ever drops runs from the bytes it was handed. Code UNITS, not code points: an offset is a
 * code-unit index everywhere in the editor, so a lone surrogate is a byte like any other here.
 */
export function isSubsequence(inner: string, outer: string): boolean {
	let at = 0;
	for (let i = 0; i < outer.length; i++) {
		if (at < inner.length && inner.charCodeAt(at) === outer.charCodeAt(i)) at++;
	}
	return at === inner.length;
}

/** Every non-line-ending byte of `before` still present in `after`, as a multiset over code units.
 *  Relaxed from equality because closing and reopening a construct DUPLICATES its delimiter run. */
export function keepsEveryByte(before: string, after: string): boolean {
	// The declared-drop exception (#106), re-derived: the rebalancer strips `droppedTail` before
	// returning its halves, so the forgiveness is bounded by the line-terminal whitespace `before`
	// holds — exact position would make this net an echo of the verifier, not an oracle.
	let droppable = (before.match(/[ \t]+(?=\r?\n|$)/g) ?? []).join('').length;
	const budget = new Map<string, number>();
	for (const byte of after.replace(/\r?\n/g, '').split('')) {
		budget.set(byte, (budget.get(byte) ?? 0) + 1);
	}
	for (const byte of before.replace(/\r?\n/g, '').split('')) {
		const left = budget.get(byte) ?? 0;
		if (left === 0) {
			if (byte.trim() === '' && droppable > 0) {
				droppable--;
				continue;
			}
			return false;
		}
		budget.set(byte, left - 1);
	}
	return true;
}
