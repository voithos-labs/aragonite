/**
 * Scanner working state, one ScanContext per scanInline call. Handlers append what they match
 * and advance `pos`; unclaimed bytes accumulate as the pending run [textStart, pos), flushed
 * before each appended node, so nodes + pending run cover [start, pos) at every step.
 */

import type { InlineNode } from '../../nodes';
import type { LinkReferenceResolver } from '../link-reference-resolver';

export interface ScanContext {
	raw: string;
	pos: number;
	end: number;
	/** Working list, flat, offset-ordered; emphasis wraps later. */
	nodes: InlineNode[];
	textStart: number;
	delimiters: Delimiter[];
	brackets: Bracket[];
	resolver?: LinkReferenceResolver;
	/**
	 * Backtick-run positions by length, built lazily on the first code-span probe and reused by
	 * every later opener so a flood stays linear (backticks.ts).
	 */
	backtickRuns?: Map<number, number[]>;
}

export interface Delimiter {
	/** Held by identity: processEmphasis reorders `nodes`, so a position would go stale. */
	node: InlineNode;
	char: '*' | '_' | '~';
	/** Remaining unconsumed run length. */
	length: number;
	/** Original run length (the multiple-of-3 rule reads this). */
	origLength: number;
	canOpen: boolean;
	canClose: boolean;
}

export interface Bracket {
	/** Stays valid across processEmphasis: a floor-f call only wraps nodes appended after it. */
	nodeIndex: number;
	isImage: boolean;
	/** Deactivated by the links-in-links rule. */
	active: boolean;
	/** A collapsed/shortcut label cannot hold an unescaped bracket, so `]` skips its lookup. */
	bracketAfter: boolean;
	/** delimiters.length at push; processEmphasis truncates back to it on match. */
	delimiterFloor: number;
}

export function createScanContext(
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver
): ScanContext {
	return {
		raw,
		pos: start,
		end,
		nodes: [],
		textStart: start,
		delimiters: [],
		brackets: [],
		resolver
	};
}

export function flushPendingText(ctx: ScanContext, upTo: number): void {
	if (ctx.textStart >= upTo) return;
	ctx.nodes.push({
		kind: 'text',
		start: ctx.textStart,
		end: upTo,
		text: ctx.raw.slice(ctx.textStart, upTo)
	});
	ctx.textStart = upTo;
}

export function appendNode(ctx: ScanContext, node: InlineNode): void {
	flushPendingText(ctx, node.start);
	ctx.nodes.push(node);
	ctx.pos = node.end;
	ctx.textStart = node.end;
}

export function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
	const result: InlineNode[] = [];
	for (const node of nodes) {
		const prev = result[result.length - 1];
		if (node.kind === 'text' && prev?.kind === 'text' && prev.end === node.start) {
			prev.end = node.end;
			prev.text = (prev.text ?? '') + (node.text ?? '');
		} else {
			result.push(node);
		}
	}
	return result;
}
