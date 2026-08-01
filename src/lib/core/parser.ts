/**
 * Single-pass GFM block parser, producing a CST where serialize(parse(source)) === source.
 * Per-kind parsers live in parsers/; this file holds dispatch and shared utilities only.
 */

import { DEV } from 'esm-env';
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
 * Container-nesting cap: past it the remaining prefix parses as paragraph content instead of
 * recursing, so pathological input degrades rather than overflowing the stack. Sits well under
 * the empirical crash point, with headroom for the tree walks that recurse to the same depth.
 * Byte-preserving, since only a top-level node's `raw` serializes and that is fixed first.
 */
export const MAX_NESTING_DEPTH = 512;

// ── Public entry point ──────────────────────────────────────────────────

/**
 * Parse GFM to a lossless CST. `opts.grammar` is the per-instance grammar view, defaulting to
 * the global openers. It filters only the TOP-LEVEL opener dispatch: nested container reparses
 * and the paragraph-interrupt scan read the global grammar, the documented enablement boundary,
 * so a top-level disabled kind is skipped and a nested one is not.
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
 * The seam block-incremental parsing re-parses ranges through. Contract, pinned by
 * test/core/parse-blocks-window.test.ts: a block-aligned window parses identically to a full
 * parse of the window's text.
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

		// Minted fresh per block, so an opener that retains the context is never re-stamped.
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
	// At the cap everything folds into a paragraph, covering the bytes without another frame.
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
		if (DEV) assertOpenerRawMatches(ctx, result);
		return result;
	}
	// Paragraph is the total fallback; it also detects setext headings and tables.
	return parseParagraph(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
}

/**
 * The `[invariant:...]` fire behind the call site's decline. An opener that consumed nothing is
 * declined in every build, not just DEV: returning it would leave `index` put and spin the parse
 * loop forever, and declining is always safe because the paragraph fallback covers the line.
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
 * DEV-only trust check on a plugin opener's `raw`, at the one site the parser consumes it:
 * bytes that do not match the consumed lines silently break the round-trip, since serialize
 * reads `raw` alone. Tree-shaken in production.
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
 * GFM §2.1: a blank line holds nothing but spaces and tabs. Deliberately not `String.trim()`,
 * which admits all Unicode whitespace: a non-breaking space is content, and a line holding one
 * continues its block.
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
