/**
 * Single-pass GFM block parser. Produces a CST where
 * serialize(parse(source)) === source. Per-kind parsers live in parsers/;
 * this file holds only top-level dispatch and shared utilities.
 */

import type { CstNode, Document } from './nodes';
import { splitLines, type ParsedLine } from './lines';
import { perfEnabled, recordParse } from '../perf/instruments';
import { matchFenceOpen, parseFencedCode } from './parsers/fenced-code';
import { matchHeading } from './parsers/heading';
import { matchThematicBreak } from './parsers/thematic-break';
import { matchBlockquote, parseBlockquote } from './parsers/blockquote';
import { matchListItem, parseList } from './parsers/list';
import { matchIndentedCode, parseIndentedCode } from './parsers/indented-code';
import { matchHtmlBlock, parseHtmlBlock } from './parsers/html-block';
import { parseLinkReferenceDefinition } from './parsers/link-reference';
import { parseParagraph } from './parsers/paragraph';

// ── Public entry point ──────────────────────────────────────────────────

export function parse(source: string): Document {
	const t0 = perfEnabled() ? performance.now() : 0;
	const lines = splitLines(source);
	const result = parseBlocks(lines, 0, lines.length);
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

export function parseBlocks(lines: ParsedLine[], start: number, end: number): ParseBlocksResult {
	const children: CstNode[] = [];
	let prefix = '';
	let pendingTrivia = '';
	let index = start;

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

	const fence = matchFenceOpen(line.text);
	if (fence) {
		return parseFencedCode(lines, startIndex, endIndex, leadingTrivia, fence);
	}

	const heading = matchHeading(line.text);
	if (heading) {
		return {
			node: { kind: 'heading', leadingTrivia, raw: line.raw, metadata: { level: heading.level } },
			nextIndex: startIndex + 1
		};
	}

	// Setext heading's `---` underline is disambiguated inside parseParagraph.
	const thematic = matchThematicBreak(line.text);
	if (thematic) {
		return {
			node: { kind: 'thematicBreak', leadingTrivia, raw: line.raw, metadata: { marker: thematic } },
			nextIndex: startIndex + 1
		};
	}

	if (matchBlockquote(line.text)) {
		return parseBlockquote(lines, startIndex, endIndex, leadingTrivia);
	}

	const listItem = matchListItem(line.text);
	if (listItem) {
		return parseList(lines, startIndex, endIndex, leadingTrivia);
	}

	// Indented code cannot interrupt a paragraph (GFM §4.4) — a dispatch-time
	// context check, not a line-level match, so it lives here not in the matcher.
	if (matchIndentedCode(line.text) && (leadingTrivia.length > 0 || isFirstBlock)) {
		return parseIndentedCode(lines, startIndex, endIndex, leadingTrivia);
	}

	if (matchHtmlBlock(line.text) !== null) {
		return parseHtmlBlock(lines, startIndex, endIndex, leadingTrivia);
	}

	const linkRef = parseLinkReferenceDefinition(lines, startIndex, endIndex, leadingTrivia);
	if (linkRef) return linkRef;

	// Paragraph fallback also detects setext headings and tables.
	return parseParagraph(lines, startIndex, endIndex, leadingTrivia);
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
