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
import { registerTableCompleter } from './parsers/table-completion';

registerBuiltInOpeners();
// The Enter completer is the typed-entry twin of the table grammar, so it loads here rather
// than behind a side-effect import the production build tree-shakes away.
registerTableCompleter();

/**
 * Container-nesting cap: past it the remaining prefix parses as paragraph content instead of
 * recursing, so pathological input degrades rather than overflowing the stack. Sits well under
 * the empirical crash point, with headroom for the tree walks that recurse to the same depth.
 * Byte-preserving, since only a top-level node's `raw` serializes and that is fixed first.
 */
export const MAX_NESTING_DEPTH = 512;

// ── Public entry point ──────────────────────────────────────────────────

/** Whether `source` is a whole document or one block's bytes read standalone. */
export type ParseScope = 'document' | 'fragment';

/**
 * Parse GFM to a lossless CST. `opts.grammar` is the per-instance grammar view, defaulting to
 * the global openers. It filters only the TOP-LEVEL opener dispatch: nested container reparses
 * and the paragraph-interrupt scan read the global grammar, the documented enablement boundary,
 * so a top-level disabled kind is skipped and a nested one is not. `opts.scope` reaches openers
 * as `ctx.isDocumentParse`; it defaults to `'document'`, so whole-source callers need nothing.
 */
export function parse(
	source: string,
	opts?: { grammar?: GrammarView; scope?: ParseScope }
): Document {
	const t0 = perfEnabled() ? performance.now() : 0;
	const lines = splitLines(source);
	const result = parseBlocks(
		lines,
		0,
		lines.length,
		opts?.grammar ?? defaultGrammarView,
		0,
		(opts?.scope ?? 'document') === 'document'
	);
	if (perfEnabled()) recordParse(performance.now() - t0, result.children.length);
	return { kind: 'document', prefix: '', children: result.children, suffix: result.suffix };
}

interface ParseBlocksResult {
	children: CstNode[];
	suffix: string;
}

/**
 * The seam block-incremental parsing re-parses ranges through: a block-aligned window parses
 * identically to a full parse of the window's text. A window is a FRAGMENT unless its caller
 * says otherwise, so `parse` alone defaults to document scope. Blank-line rule
 * (`design/syntax-tree.md`): the first blank line of a run separates and folds into trivia;
 * every later one is an empty paragraph carrying its own bytes.
 */
export function parseBlocks(
	lines: ParsedLine[],
	start: number,
	end: number,
	grammar: GrammarView = defaultGrammarView,
	depth: number = 0,
	isDocumentParse: boolean = false
): ParseBlocksResult {
	const children: CstNode[] = [];
	let pendingTrivia = '';
	// Nothing precedes the window's first block, so its separator slot opens already spent —
	// which is what makes a leading run materialize in full.
	let separatorSpent = true;
	let index = start;

	while (index < end) {
		const line = lines[index];

		if (isBlankLine(line.text)) {
			// A zero-byte line is a container strip's artifact, not one the author wrote: it can
			// neither separate nor render.
			if (line.raw !== '') {
				if (separatorSpent) {
					children.push({ kind: 'paragraph', leadingTrivia: pendingTrivia, raw: line.raw });
					pendingTrivia = '';
				} else {
					pendingTrivia += line.raw;
					separatorSpent = true;
				}
			}
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
			isDocumentParse,
			grammar,
			depth
		};
		const { node, consumed } = parseNextBlock(ctx);
		children.push(node);
		pendingTrivia = '';
		separatorSpent = false;
		index += consumed;
	}

	return { children, suffix: pendingTrivia };
}

export interface ContainerBodyWrap {
	/** A chrome line of the container's own sits above the body (`:::note`, `<summary>`). */
	afterOpenerLine?: boolean;
	/** A chrome line of the container's own sits below the body (`:::`, `</details>`). */
	beforeCloserLine?: boolean;
}

/**
 * Parse a container body between the container's own chrome lines; a body starting at the
 * container's own first line (blockquote, list item) has no wrap and uses `parse`. A blank line
 * against a chrome line separates as it does between blocks, landing in `prefix`/`suffix` while
 * the rest of its run materializes as body content; one with no body on its far side separated
 * nothing and stays content. `opts.scope` is required: a new entry cannot recover it (G4.27).
 */
export function parseContainerBody(
	bodyText: string,
	wrap: ContainerBodyWrap,
	opts: { scope: ParseScope; depth?: number }
): Document {
	const lines = splitLines(bodyText);
	let first = 0;
	let last = lines.length;
	let prefix = '';
	let suffix = '';

	if (wrap.afterOpenerLine && last - first >= 2 && isBlankLine(lines[first].text)) {
		prefix = lines[first].raw;
		first++;
	}
	if (wrap.beforeCloserLine && last - first >= 2 && isBlankLine(lines[last - 1].text)) {
		last--;
		suffix = lines[last].raw;
	}

	const inner = parseBlocks(
		lines,
		first,
		last,
		defaultGrammarView,
		opts.depth ?? 0,
		opts.scope === 'document'
	);
	return { kind: 'document', prefix, children: inner.children, suffix: inner.suffix + suffix };
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

/**
 * Nothing but blank lines — what the blank-line rule mints a block from. Blankness is the
 * parser's (GFM §2.1), never `String.trim()`: a non-breaking space is content.
 */
export function isBlankSource(source: string): boolean {
	return splitLines(source).every((line) => isBlankLine(line.text));
}

export function isBlankParagraph(node: { kind: string; raw: string }): boolean {
	return node.kind === 'paragraph' && isBlankSource(node.raw);
}

export function joinRaw(lines: ParsedLine[], startIndex: number, endIndex: number): string {
	let result = '';
	for (let i = startIndex; i < endIndex; i++) {
		result += lines[i].raw;
	}
	return result;
}
