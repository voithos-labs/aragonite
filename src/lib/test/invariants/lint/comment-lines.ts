/**
 * The comment lexer the two G4.26 scans share: every `//` run, block comment and HTML comment
 * in a source file, with its text lines stripped of comment syntax.
 */

export interface CommentBlock {
	/** 1-based line the block starts on. */
	line: number;
	/** The block's lines that still hold text once comment syntax is stripped. */
	text: string[];
	isHeader: boolean;
}

const BLOCK_OPENERS: [open: string, close: string][] = [
	['/*', '*/'],
	['<!--', '-->']
];

/** A first block this far into the file is the header (imports may precede it). */
const HEADER_WINDOW = 30;

export function stripCommentSyntax(line: string): string {
	return line
		.trim()
		.replace(/^\/\*+|^\*+\/?|^\/\/+|^<!--|-->$|\*+\/$/g, '')
		.trim();
}

export function findCommentBlocks(code: string): CommentBlock[] {
	const lines = code.split('\n');
	const blocks: CommentBlock[] = [];
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
			blocks.push({ line: start + 1, text, isHeader: false });
		} else if (trimmed.startsWith('//')) {
			const start = i;
			const text: string[] = [];
			while (i < lines.length && lines[i].trim().startsWith('//')) {
				const stripped = stripCommentSyntax(lines[i]);
				if (stripped !== '') text.push(stripped);
				i += 1;
			}
			i -= 1;
			blocks.push({ line: start + 1, text, isHeader: false });
		}
		i += 1;
	}
	if (blocks.length > 0 && blocks[0].line <= HEADER_WINDOW) blocks[0].isHeader = true;
	return blocks;
}
