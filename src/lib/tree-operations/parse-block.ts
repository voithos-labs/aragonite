import type { CstNode } from '../core/nodes';
import { isBlankLine } from '../core/lines';
import type { FragmentReader } from './list/task-paragraph';

/** Read one block's `raw` with the reader of the slot it lands in and return its first block,
 *  falling back to a paragraph node. */
export function parseFirstBlock(raw: string, read: FragmentReader): CstNode {
	const doc = read(raw);
	if (doc.children.length > 0) return doc.children[0];
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

export interface CutResidue {
	/** The rest of the cut line with its line ending when that rest is only whitespace, else ''. */
	endedLine: string;
	/** Every block the text after `endedLine` parses to. */
	blocks: CstNode[];
}

/**
 * The text after a paste's cut, as blocks read with the reader of the slot they land in; a line
 * break left at its head comes back as `endedLine`, so the caller decides where the break goes.
 */
export function parseCutResidue(
	text: string,
	lineEnding: '\n' | '\r\n',
	read: FragmentReader
): CutResidue {
	const lineBreak = /\r?\n/.exec(text);
	const endedLine =
		lineBreak && isBlankLine(text.slice(0, lineBreak.index))
			? text.slice(0, lineBreak.index + lineBreak[0].length)
			: '';
	const body = text.slice(endedLine.length);
	if (body === '') return { endedLine, blocks: [] };
	return { endedLine, blocks: read(body + lineEnding).children };
}
