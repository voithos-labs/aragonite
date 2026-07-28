/**
 * Single-pass GFM block parser. Produces a CST where
 * serialize(parse(source)) === source. Per-kind parsers live in parsers/;
 * this file holds only top-level dispatch and shared utilities.
 */

import type { CstNode, Document } from './nodes';
import { splitLines, type ParsedLine } from './lines';
import { perfEnabled, recordParse } from '../perf/instruments';
import {
	defaultGrammarView,
	type BlockOpenerResult,
	type GrammarView,
	type OpenContext
} from '../schema/block-openers';
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
 * Parse GFM to a lossless CST. `opts.grammar` is the per-instance grammar view —
 * absent = the global openers (the editorless,
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

	while (index < end) {
		const line = lines[index];

		if (isBlankLine(line.text)) {
			pendingTrivia += line.raw;
			index++;
			continue;
		}

		// Minted fresh per block: an opener that retains the context sees a value
		// stable for its own dispatch, never one re-stamped by the next block.
		const ctx: OpenContext = {
			lines,
			index,
			end,
			line,
			leadingTrivia: pendingTrivia,
			isFirstInWindow: children.length === 0,
			grammar,
			depth
		};
		const { node, consumed } = parseNextBlock(ctx);
		children.push(node);
		pendingTrivia = '';
		index += consumed;
	}

	return { prefix, children, suffix: pendingTrivia };
}

// ── Dispatch ────────────────────────────────────────────────────────────

function parseNextBlock(ctx: OpenContext): BlockOpenerResult {
	// At the nesting cap, no container may recurse further — everything folds into
	// a paragraph so the remaining bytes stay covered without another stack frame.
	if (ctx.depth >= MAX_NESTING_DEPTH) {
		return parseParagraph(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
	}
	for (const opener of ctx.grammar.orderedOpeners()) {
		const result = opener.tryOpen(ctx);
		if (!result) continue;
		if (result.consumed <= 0) {
			reportNonAdvancingOpener(ctx, result);
			continue;
		}
		if (import.meta.env.DEV) assertOpenerRawMatches(ctx, result);
		return result;
	}
	// Paragraph is the total fallback; it also detects setext headings and tables.
	return parseParagraph(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
}

/**
 * The `[invariant:…]` fire behind the call site's decline. An opener that matched but
 * consumed nothing is declined in every build, not just DEV: returning it would leave
 * `index` where it was and spin the parse loop forever (a hung tab on document load),
 * and declining is always safe — the next opener, ultimately the paragraph fallback,
 * covers the line. The message names the decline as well as the kind, so an author can
 * connect "my block renders as a paragraph" to its cause.
 */
function reportNonAdvancingOpener(ctx: OpenContext, result: BlockOpenerResult): void {
	assertInvariant('opener-advance', () => ({
		code: 'opener-did-not-advance',
		message:
			`block opener for kind "${result.node.kind}" claimed no line at ${ctx.index} and was ` +
			`declined — an opener must consume at least one line (return consumed >= 1)`,
		detail: result.node.kind
	}));
}

/**
 * DEV-only trust check on a plugin opener's `raw`, at the one site the parser
 * consumes it: bytes that don't match the consumed lines silently break
 * `serialize(parse(source)) === source` (serialize reads `raw` only).
 * O(consumed lines); tree-shaken in production.
 */
function assertOpenerRawMatches(ctx: OpenContext, result: BlockOpenerResult): void {
	assertInvariant('opener-raw', () =>
		result.node.raw === joinRaw(ctx.lines, ctx.index, ctx.index + result.consumed)
			? null
			: {
					code: 'opener-stale-raw',
					message:
						`opener for kind "${result.node.kind}" built raw that does not byte-match its ` +
						`${result.consumed} consumed source line(s)`,
					detail: result.node.kind
				}
	);
}

// ── Shared utilities ────────────────────────────────────────────────────

/**
 * GFM §2.1: a blank line holds nothing but spaces (U+0020) and tabs (U+0009).
 * Deliberately not `String.trim()`, which admits the whole Unicode whitespace
 * set — a non-breaking space, the commonest artifact of a paste out of a word
 * processor, is content, and a line holding one continues its block.
 */
const NON_BLANK_CHAR = /[^ \t]/;

export function isBlankLine(text: string): boolean {
	return !NON_BLANK_CHAR.test(text);
}

export function joinRaw(lines: ParsedLine[], startIndex: number, endIndex: number): string {
	let result = '';
	for (let i = startIndex; i < endIndex; i++) {
		result += lines[i].raw;
	}
	return result;
}
