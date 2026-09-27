/**
 * The comment lexer the two G4.26 scans share: every `//` run, block comment and HTML comment
 * in a source file, with its text lines stripped of comment syntax, and which of them are
 * headers.
 */

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

const BLOCK_OPENERS: [open: string, close: string][] = [
	['/*', '*/'],
	['<!--', '-->']
];

/** A first block this far into the file is the header (imports may precede it). */
const HEADER_WINDOW = 30;

const SECTION_DIVIDER = /^─{2}.*─{2}$/;

export function stripCommentSyntax(line: string): string {
	return line
		.trim()
		.replace(/^\/\*+|^\*+\/?|^\/\/+|^<!--|-->$|\*+\/$/g, '')
		.trim();
}

/** Text lines the budget counts: a `// ── Name ──` section divider is not one. */
export function budgetLines(block: CommentBlock): number {
	return block.text.filter((line) => !SECTION_DIVIDER.test(line)).length;
}

export function isOverBudget(block: CommentBlock): boolean {
	return budgetLines(block) > (block.isHeader ? HEADER_BUDGET : BODY_BUDGET);
}

/** `relPath` (from the repo root) decides the entry-point case; without it only the other two apply. */
export function findCommentBlocks(code: string, relPath = ''): CommentBlock[] {
	const lines = code.split('\n');
	const spans: { block: CommentBlock; end: number }[] = [];
	let i = 0;
	while (i < lines.length) {
		const trimmed = lines[i].trim();
		const opener = BLOCK_OPENERS.find(([open]) => trimmed.startsWith(open));
		if (opener) {
			const start = i;
			const text: string[] = [];
			while (i < lines.length) {
				const stripped = stripCommentSyntax(lines[i]);
				if (stripped !== '') text.push(stripped);
				if (lines[i].includes(opener[1])) break;
				i += 1;
			}
			spans.push({ block: { line: start + 1, text, isHeader: false }, end: i });
		} else if (trimmed.startsWith('//')) {
			const start = i;
			const text: string[] = [];
			while (i < lines.length && lines[i].trim().startsWith('//')) {
				const stripped = stripCommentSyntax(lines[i]);
				if (stripped !== '') text.push(stripped);
				i += 1;
			}
			i -= 1;
			spans.push({ block: { line: start + 1, text, isHeader: false }, end: i });
		}
		i += 1;
	}
	classifyHeaders(lines, spans, PUBLISHED_ENTRY_POINTS.includes(relPath));
	return spans.map((s) => s.block);
}

/**
 * A header is a file's first block, a docblock directly above an exported interface or type,
 * or, in a published entry point, a docblock on an export or on a member of one.
 */
function classifyHeaders(
	lines: string[],
	spans: { block: CommentBlock; end: number }[],
	isEntryPoint: boolean
): void {
	if (spans.length > 0 && spans[0].block.line <= HEADER_WINDOW) spans[0].block.isHeader = true;
	for (const { block, end } of spans) {
		const opening = lines[block.line - 1];
		if (!opening.trim().startsWith('/**')) continue;
		const next = (lines.slice(end + 1).find((line) => line.trim() !== '') ?? '').trim();
		if (/^export\s+(interface|type)\b/.test(next)) block.isHeader = true;
		if (!isEntryPoint) continue;
		if (next.startsWith('export ')) block.isHeader = true;
		if (/^\s/.test(opening) && enclosingDeclaration(lines, block.line - 1).startsWith('export ')) {
			block.isHeader = true;
		}
	}
}

/** The nearest line above `index` that starts at column 0 and is not a comment. */
function enclosingDeclaration(lines: string[], index: number): string {
	for (let k = index - 1; k >= 0; k--) {
		const line = lines[k];
		if (line === '' || /^\s/.test(line) || /^(\/\/|\/\*|\*)/.test(line)) continue;
		return line;
	}
	return '';
}
