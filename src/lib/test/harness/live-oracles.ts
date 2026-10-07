/**
 * The checks that hold a rewrite to what live-mode.md § 2 allows: what it may drop, and the
 * leftovers § 4.1 forbids it from creating. The split and join property suites and the gesture
 * fuzzer all share these, so one reading of the rule answers for all three.
 */

import { constructContentRange, parseInline } from '#lib/core/inline/index.js';
import type { InlineNode } from '#lib/core/nodes.js';
import { getInlineConstructPolicy } from '#lib/schema/inline-construct-policy.js';

/** The leftovers § 4.1 forbids: an emptied construct whose row declares `autoUnwrapOnEmpty`. Read
 *  off the parse, not a delimiter spelling, so two legitimate runs meeting do not count. */
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

/** Whether `inner` can be read off `outer` by deleting characters: a rewrite that only drops runs.
 *  Compares code units, since every editor offset is a code-unit index. */
export function isSubsequence(inner: string, outer: string): boolean {
	let at = 0;
	for (let i = 0; i < outer.length; i++) {
		if (at < inner.length && inner.charCodeAt(at) === outer.charCodeAt(i)) at++;
	}
	return at === inner.length;
}

/** Every non-line-ending byte of `before` still present in `after`, as a multiset over code units.
 *  Relaxed from equality because closing and reopening a construct duplicates its delimiter run. */
export function keepsEveryByte(before: string, after: string): boolean {
	// Only the line-ending whitespace `before` holds may go; matching the rebalancer's exact
	// position would echo the code under test instead of checking it.
	let droppable = (before.match(/[ \t]+(?=\r?\n|$)/g) ?? []).join('').length;
	const budget = new Map<string, number>();
	for (const byte of after.replace(/\r?\n/g, '').split('')) {
		budget.set(byte, (budget.get(byte) ?? 0) + 1);
	}
	for (const byte of before.replace(/\r?\n/g, '').split('')) {
		const left = budget.get(byte) ?? 0;
		if (left === 0) {
			if ((byte === ' ' || byte === '\t') && droppable > 0) {
				droppable--;
				continue;
			}
			return false;
		}
		budget.set(byte, left - 1);
	}
	return true;
}
