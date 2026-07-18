/**
 * Single-pass GFM block parser. Produces a CST where
 * serialize(parse(source)) === source. Per-kind parsers live in parsers/;
 * this file holds only top-level dispatch and shared utilities.
 */

import type { CstNode, Document } from './nodes';
import { splitLines, type ParsedLine } from './lines';
import { perfEnabled, recordParse } from '../perf/instruments';
import { defaultGrammarView, type GrammarView, type OpenContext } from '../schema/block-openers';
import { assertInvariant } from '../invariants/assert';
import { parseParagraph } from './parsers/paragraph';
import { registerBuiltInOpeners } from './parsers/built-in-openers';

registerBuiltInOpeners();

/**
 * Container-nesting cap. Each blockquote/list/directive level recurses one
 * `parseBlocks` deep; past this cap the remaining prefix parses as the innermost
 * block's paragraph content instead of nesting further, so pathological input
 * (thousands of `>` or nested items) degrades gracefully rather than overflowing
 * the call stack. Chosen well under the ~2000-level empirical crash point, with
 * headroom for the tree walks (render, undo, tree-ops) that also recurse to this
 * depth — far beyond any real document. Byte-preserving: only a top-level node's
 * `raw` is serialized, and that is fixed before the recursion runs.
 */
export const MAX_NESTING_DEPTH = 512;

// ── Public entry point ──────────────────────────────────────────────────

/**
 * Parse GFM to a lossless CST. `opts.grammar` is the per-instance grammar view
 * (docs/research/architecture-concerns.md) — absent = the global openers (the editorless,
 * behavior-preserving default). It filters only the TOP-LEVEL opener dispatch:
 * nested container reparses (blockquote/list bodies) and the paragraph-interrupt
 * scan read the global grammar, the documented enablement boundary — a top-level
 * disabled kind is skipped, a nested one is not. In-editor reparse callers thread
 * their instance grammar the same way (`updateNodeContent`); the unthreaded ones
 * (`parse-block`, split/merge reparse, paste) default to global and so stay
 * byte-identical.
 */
export function parse(source: string, opts?: { grammar?: GrammarView }): Document {
	const t0 = perfEnabled() ? performance.now() : 0;
	const lines = splitLines(source);
	const result = parseBlocks(lines, 0, lines.length, opts?.grammar ?? defaultGrammarView);
	if (perfEnabled()) recordParse(performance.now() - t0, result.children.length);
	return {
		kind: 'document',
		prefix: result.prefix,
		children: result.children,
		suffix: result.suffix
	};
}

interface ParseBlocksResult {
	prefix: string;
	children: CstNode[];
	suffix: string;
}

/**
 * Stable seam for block-incremental parsing: re-parses ranges through this
 * window. Contract (pinned by test/core/parse-blocks-window.test.ts):
 * a [start, end) window aligned to block starts parses identically to a
 * full parse of the window's text.
 */
export function parseBlocks(
	lines: ParsedLine[],
	start: number,
	end: number,
	grammar: GrammarView = defaultGrammarView,
	depth: number = 0
): ParseBlocksResult {
	const children: CstNode[] = [];
	let prefix = '';
	let pendingTrivia = '';
	let index = start;

	while (index < end && isBlankLine(lines[index].text)) {
		prefix += lines[index].raw;
		index++;
	}

	if (index === end) return { prefix, children, suffix: pendingTrivia };

	// Reused across the loop — openers must not retain it.
	const ctx: OpenContext = {
		lines,
		index,
		end,
		line: lines[index],
		leadingTrivia: '',
		isFirstInWindow: true,
		grammar,
		depth
	};

	while (index < end) {
		const line = lines[index];

		if (isBlankLine(line.text)) {
			pendingTrivia += line.raw;
			index++;
			continue;
		}

		ctx.index = index;
		ctx.line = line;
		ctx.leadingTrivia = pendingTrivia;
		ctx.isFirstInWindow = children.length === 0;
		const { node, nextIndex } = parseNextBlock(ctx);
		children.push(node);
		pendingTrivia = '';
		index = nextIndex;
	}

	return { prefix, children, suffix: pendingTrivia };
}

// ── Dispatch ────────────────────────────────────────────────────────────

function parseNextBlock(ctx: OpenContext): { node: CstNode; nextIndex: number } {
	// At the nesting cap, no container may recurse further — everything folds into
	// a paragraph so the remaining bytes stay covered without another stack frame.
	if (ctx.depth >= MAX_NESTING_DEPTH) {
		return parseParagraph(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	}
	for (const opener of ctx.grammar.orderedOpeners()) {
		const result = opener.tryOpen(ctx);
		if (result) {
			if (import.meta.env.DEV) guardOpenerResult(ctx, result);
			return result;
		}
	}
	// Paragraph is the total fallback; it also detects setext headings and tables.
	return parseParagraph(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
}

/**
 * DEV-only trust check on a plugin opener's return, at the one site the parser
 * consumes it. A non-advancing `nextIndex` would spin the parse loop forever
 * (browser hang on load), so it throws — naming the offending kind — instead of
 * hanging. A `raw` that doesn't byte-match the consumed lines silently breaks
 * `serialize(parse(source)) === source` (serialize reads `raw` only), so it fires
 * the invariant channel. Both O(consumed lines); tree-shaken in production.
 */
function guardOpenerResult(ctx: OpenContext, result: { node: CstNode; nextIndex: number }): void {
	if (result.nextIndex <= ctx.index) {
		throw new Error(
			`block opener for kind "${result.node.kind}" did not advance past line ${ctx.index} — ` +
				`an opener must consume at least one line (return nextIndex > ctx.index)`
		);
	}
	assertInvariant('opener-raw', () =>
		result.node.raw === joinRaw(ctx.lines, ctx.index, result.nextIndex)
			? null
			: {
					code: 'opener-stale-raw',
					message:
						`opener for kind "${result.node.kind}" built raw that does not byte-match its ` +
						`${result.nextIndex - ctx.index} consumed source line(s)`,
					detail: result.node.kind
				}
	);
}

// ── Shared utilities ────────────────────────────────────────────────────

export function isBlankLine(text: string): boolean {
	return text.trim().length === 0;
}

export function joinRaw(lines: ParsedLine[], startIndex: number, endIndex: number): string {
	let result = '';
	for (let i = startIndex; i < endIndex; i++) {
		result += lines[i].raw;
	}
	return result;
}
