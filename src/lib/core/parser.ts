/**
 * Single-pass, line-oriented GFM block parser.
 * Produces a recursive CST where serialize(parse(source)) === source.
 * Per-kind match and parse functions live in core/parsers/; this file
 * retains only the top-level dispatch, shared utilities, and the public
 * entry points (parse, parseBlocks).
 */

import type { CstNode, Document } from './nodes';
import { splitLines, type ParsedLine } from './lines';
import { matchFenceOpen, parseFencedCode } from './parsers/fenced-code';
import { matchHeading } from './parsers/heading';
import { matchThematicBreak } from './parsers/thematic-break';
import { matchBlockquote, parseBlockquote } from './parsers/blockquote';
import { matchListItem, parseList } from './parsers/list';
import { matchIndentedCode, parseIndentedCode } from './parsers/indented-code';
import { matchHtmlBlock, parseHtmlBlock } from './parsers/html-block';
import { matchLinkReferenceDefinition } from './parsers/link-reference';
import { parseParagraph } from './parsers/paragraph';

// Re-export public matcher helpers so existing external callers
// (`from '../core/parser'` import sites in tests and e2e helpers)
// continue to resolve unchanged after the kind-split.
export { matchThematicBreak } from './parsers/thematic-break';
export { matchListItem } from './parsers/list';

// ── Public entry point ──────────────────────────────────────────────────

/** Parse a markdown source string into a Document CST. */
export function parse(source: string): Document {
	const lines = splitLines(source);
	const result = parseBlocks(lines, 0, lines.length);
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

export function parseBlocks(
	lines: ParsedLine[],
	start: number,
	end: number
): ParseBlocksResult {
	const children: CstNode[] = [];
	let prefix = '';
	let pendingTrivia = '';
	let index = start;

	// Consume leading blank lines into prefix
	while (index < end && isBlankLine(lines[index].text)) {
		prefix += lines[index].raw;
		index++;
	}

	while (index < end) {
		const line = lines[index];

		if (isBlankLine(line.text)) {
			pendingTrivia += line.raw;
			index++;
			continue;
		}

		const { node, nextIndex } = parseNextBlock(
			lines,
			index,
			end,
			pendingTrivia,
			children.length === 0
		);
		children.push(node);
		pendingTrivia = '';
		index = nextIndex;
	}

	return { prefix, children, suffix: pendingTrivia };
}

// ── Dispatch ────────────────────────────────────────────────────────────

function parseNextBlock(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	isFirstBlock: boolean = false
): { node: CstNode; nextIndex: number } {
	const line = lines[startIndex];

	// Fenced code block
	const fence = matchFenceOpen(line.text);
	if (fence) {
		return parseFencedCode(lines, startIndex, endIndex, leadingTrivia, fence);
	}

	// ATX heading
	const heading = matchHeading(line.text);
	if (heading) {
		return {
			node: { kind: 'heading', leadingTrivia, raw: line.raw, metadata: { level: heading.level } },
			nextIndex: startIndex + 1
		};
	}

	// Thematic break — setext detection inside parseParagraph handles the ---/=== ambiguity
	const thematic = matchThematicBreak(line.text);
	if (thematic) {
		return {
			node: { kind: 'thematicBreak', leadingTrivia, raw: line.raw, metadata: { marker: thematic } },
			nextIndex: startIndex + 1
		};
	}

	// Blockquote
	if (matchBlockquote(line.text)) {
		return parseBlockquote(lines, startIndex, endIndex, leadingTrivia);
	}

	// List item
	const listItem = matchListItem(line.text);
	if (listItem) {
		return parseList(lines, startIndex, endIndex, leadingTrivia);
	}

	// Indented code block — cannot interrupt a paragraph (GFM spec 4.4). The
	// interruption rule is a dispatch-time context check, not a line-level
	// match; hence it lives here rather than inside the matcher.
	if (matchIndentedCode(line.text) && (leadingTrivia.length > 0 || isFirstBlock)) {
		return parseIndentedCode(lines, startIndex, endIndex, leadingTrivia);
	}

	// HTML block
	if (matchHtmlBlock(line.text)) {
		return parseHtmlBlock(lines, startIndex, endIndex, leadingTrivia);
	}

	// Link reference definition (exclude footnote labels starting with ^)
	const linkRef = matchLinkReferenceDefinition(line.text);
	if (linkRef) {
		return {
			node: {
				kind: 'linkReferenceDefinition',
				leadingTrivia,
				raw: line.raw,
				metadata: { label: linkRef.label }
			},
			nextIndex: startIndex + 1
		};
	}

	// Fallback: paragraph (also detects setext headings and tables)
	return parseParagraph(lines, startIndex, endIndex, leadingTrivia);
}

// ── Shared utilities ────────────────────────────────────────────────────

export function isBlankLine(text: string): boolean {
	return text.trim().length === 0;
}

/** Concatenate `raw` across a line range. Shared with core/parsers/*.ts. */
export function joinRaw(lines: ParsedLine[], startIndex: number, endIndex: number): string {
	let result = '';
	for (let i = startIndex; i < endIndex; i++) {
		result += lines[i].raw;
	}
	return result;
}
