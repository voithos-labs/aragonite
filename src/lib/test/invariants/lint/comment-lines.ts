/**
 * The comment blocks the two G4.26 scans share, read through the shared lexer: adjacent `//`
 * lines make one block, and a header gets the longer budget.
 */

import { commentSpans, commentText, languageOf, type CommentSpan } from './scan-source';

export interface CommentBlock {
	/** 1-based line the block starts on. */
	line: number;
	/** The block's lines that still hold text once comment syntax is stripped. */
	text: string[];
	/** A header gets the longer budget; `classifyHeaders` lists the three cases. */
	isHeader: boolean;
}

const BODY_BUDGET = 2;
const HEADER_BUDGET = 5;

/** Docblocks on these files' exports ship in the `.d.ts` a consumer hovers. */
const PUBLISHED_ENTRY_POINTS = [
	'src/lib/index.ts',
	'src/lib/plugin.ts',
	'src/lib/testing.ts',
	'src/lib/editor-props.ts',
	'src/lib/block-component.ts'
];

/** A first block this far into the file is the header (imports may precede it). */
const HEADER_WINDOW = 30;

const SECTION_DIVIDER = /^─{2}.*─{2}$/;

/** Text lines the budget counts: a section divider or a tool directive is not prose. */
const TOOL_DIRECTIVE = /^(svelte-ignore|eslint-|@ts-|prettier-ignore|istanbul |c8 )/;

export function budgetLines(block: CommentBlock): number {
	return block.text.filter((line) => !SECTION_DIVIDER.test(line) && !TOOL_DIRECTIVE.test(line))
		.length;
}

export function isOverBudget(block: CommentBlock): boolean {
	return budgetLines(block) > (block.isHeader ? HEADER_BUDGET : BODY_BUDGET);
}

interface Placed {
	block: CommentBlock;
	/** The block's last comment. */
	last: CommentSpan;
	/** 0-based line the block ends on. */
	endLine: number;
	/** Whether the block starts its line rather than trailing code. */
	ownLine: boolean;
}

/** `relPath` (from the repo root) picks the language and decides the entry-point case. */
export function findCommentBlocks(code: string, relPath: string): CommentBlock[] {
	const spans = commentSpans(code, languageOf(relPath));
	const lineOf = lineCounter(code);
	const placed: Placed[] = [];
	for (const span of spans) {
		const startLine = lineOf(span.start);
		const text = commentText(code, span);
		const ownLine = code.slice(code.lastIndexOf('\n', span.start) + 1, span.start).trim() === '';
		const previous = placed.at(-1);
		// A `//` line joins the `//` lines directly above it; a comment trailing code stands alone.
		const joins =
			ownLine &&
			previous !== undefined &&
			previous.ownLine &&
			span.kind === 'line' &&
			previous.last.kind === 'line' &&
			previous.endLine === startLine - 1;
		if (joins) {
			previous.block.text.push(...text);
			previous.last = span;
			previous.endLine = startLine;
		} else {
			const block = { line: startLine + 1, text, isHeader: false };
			placed.push({ block, last: span, endLine: lineOf(span.end - 1), ownLine });
		}
	}
	classifyHeaders(code, placed, spans, PUBLISHED_ENTRY_POINTS.includes(relPath));
	return placed.map((p) => p.block);
}

/** 0-based line of an offset; offsets must come in ascending order. */
function lineCounter(code: string): (offset: number) => number {
	let line = 0;
	let at = 0;
	return (offset) => {
		for (; at < offset; at++) if (code[at] === '\n') line++;
		return line;
	};
}

/** The first non-blank text after an offset, to the end of its line. */
const NEXT_LINE = /\s*([^\n]*)/y;

/**
 * A header is a file's first block on a line of its own, a docblock directly above an exported
 * interface or type, or, in a published entry point, a docblock on an export or a member of one.
 */
function classifyHeaders(
	code: string,
	placed: Placed[],
	spans: CommentSpan[],
	isEntryPoint: boolean
): void {
	const first = placed.find((p) => p.ownLine);
	if (first !== undefined && first.block.line <= HEADER_WINDOW) first.block.isHeader = true;
	const lines = code.split('\n');
	for (const { block, last } of placed) {
		if (!code.startsWith('/**', last.start)) continue;
		NEXT_LINE.lastIndex = last.end;
		const next = NEXT_LINE.exec(code)?.[1] ?? '';
		if (/^export\s+(interface|type)\b/.test(next)) block.isHeader = true;
		if (!isEntryPoint) continue;
		if (next.startsWith('export ')) block.isHeader = true;
		const indented = /^\s/.test(lines[block.line - 1]);
		if (indented && enclosingDeclaration(lines, spans, block.line - 1).startsWith('export ')) {
			block.isHeader = true;
		}
	}
}

/** The nearest line above `index` that starts at column 0 outside every comment. */
function enclosingDeclaration(lines: string[], spans: CommentSpan[], index: number): string {
	let offset = lines.slice(0, index).reduce((n, line) => n + line.length + 1, 0);
	for (let k = index - 1; k >= 0; k--) {
		offset -= lines[k].length + 1;
		const line = lines[k];
		if (line === '' || /^\s/.test(line)) continue;
		if (spans.some((span) => span.start <= offset && offset < span.end)) continue;
		return line;
	}
	return '';
}
