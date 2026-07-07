/**
 * Scanner working state. One ScanContext per scanInline call. Handlers
 * append the nodes they match and advance `pos` past them; bytes no handler
 * claims accumulate as the pending text run [textStart, pos), flushed to a
 * text node before each appended node — so nodes + pending run cover
 * [start, pos) at every step of the scan.
 */

import type { InlineNode } from '../../nodes';
import type { LinkReferenceResolver } from '../link-reference-resolver';

export interface ScanContext {
	raw: string;
	pos: number;
	end: number;
	/** Working list, flat, offset-ordered; emphasis wraps later. */
	nodes: InlineNode[];
	/** Start of the pending text run: bytes in [textStart, pos) not yet claimed by any node. */
	textStart: number;
	delimiters: Delimiter[];
	brackets: Bracket[];
	resolver?: LinkReferenceResolver;
}

export interface Delimiter {
	/** The text node holding the run's bytes. */
	nodeIndex: number;
	char: '*' | '_' | '~';
	/** Remaining unconsumed run length. */
	length: number;
	/** Original run length (the multiple-of-3 rule reads this). */
	origLength: number;
	canOpen: boolean;
	canClose: boolean;
	active: boolean;
}

export interface Bracket {
	/** The '[' / '![' text node. */
	nodeIndex: number;
	isImage: boolean;
	/** Deactivated by the links-in-links rule. */
	active: boolean;
	/** delimiters.length at push — processEmphasis floor on match. */
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

/** Flush the pending text run as a text node ending at `upTo`. */
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

/** Append a matched node, flushing pending text before it and advancing past it. */
export function appendNode(ctx: ScanContext, node: InlineNode): void {
	flushPendingText(ctx, node.start);
	ctx.nodes.push(node);
	ctx.pos = node.end;
	ctx.textStart = node.end;
}
