/**
 * Single-pass GFM block parser. Produces a CST where
 * serialize(parse(source)) === source. Per-kind parsers live in parsers/;
 * this file holds only top-level dispatch and shared utilities.
 */

import type { CstNode, Document } from './nodes';
import { splitLines, type ParsedLine } from './lines';
import { perfEnabled, recordParse } from '../perf/instruments';
import { getOrderedOpeners, type OpenContext } from '../schema/block-openers';
import { parseParagraph } from './parsers/paragraph';
import './parsers/built-in-openers';

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

/**
 * Stable seam for block-incremental parsing: re-parses ranges through this
 * window. Contract (pinned by test/core/parse-blocks-window.test.ts):
 * a [start, end) window aligned to block starts parses identically to a
 * full parse of the window's text.
 */
export function parseBlocks(lines: ParsedLine[], start: number, end: number): ParseBlocksResult {
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
		isFirstInWindow: true
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
	for (const opener of getOrderedOpeners()) {
		const result = opener.tryOpen(ctx);
		if (result) return result;
	}
	// Paragraph is the total fallback; it also detects setext headings and tables.
	return parseParagraph(ctx.lines, ctx.index, ctx.end, ctx.leadingTrivia);
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
