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
	/**
	 * Backtick-run positions by length, built lazily on the first code-span probe
	 * and reused for every later opener so a flood stays linear (see backticks.ts).
	 */
	backtickRuns?: Map<number, number[]>;
}

export interface Delimiter {
	/**
	 * The text node holding the run's bytes, by identity: processEmphasis
	 * reorders `nodes` when it wraps a match, so a position would go stale
	 * where an object reference cannot.
	 */
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
	/**
	 * The '[' / '![' text node's position. Stays valid across processEmphasis:
	 * a floor-f call only wraps nodes appended after the bracket that recorded
	 * floor f, so positions at or before any live bracket never shift.
	 */
	nodeIndex: number;
	isImage: boolean;
	/** Deactivated by the links-in-links rule. */
	active: boolean;
	/**
	 * A later bracket opened while this one was innermost. Collapsed/shortcut
	 * references reuse the link text as label, and a label cannot contain an
	 * unescaped bracket — the `]` handler skips their lookup outright.
	 */
	bracketAfter: boolean;
	/**
	 * delimiters.length at push — processEmphasis floor on match. A floor-f
	 * call truncates the delimiter stack back to f, so floors recorded by
	 * enclosing brackets (all <= f) stay valid.
	 */
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
