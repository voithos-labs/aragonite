import type { CstNode } from '../core/nodes';
import { isBlankLine } from '../core/lines';
import { readBlocks } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';

/** Parse one block's `raw` in the editor's grammar and return its first block, falling back to a
 *  paragraph node. */
export function parseFirstBlock(raw: string, grammar: GrammarView): CstNode {
	const doc = readBlocks(raw, { grammar, scope: 'fragment' });
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
 * The text after a paste's cut in a leaf, as blocks. A cut at the end of a line leaves that
 * line's break at the head of the text; it is handed back as `endedLine` rather than read as a
 * blank block, so the caller decides where the break goes.
 */
export function parseCutResidue(
	text: string,
	lineEnding: '\n' | '\r\n',
	grammar: GrammarView
): CutResidue {
	const lineBreak = /\r?\n/.exec(text);
	const endedLine =
		lineBreak && isBlankLine(text.slice(0, lineBreak.index))
			? text.slice(0, lineBreak.index + lineBreak[0].length)
			: '';
	const body = text.slice(endedLine.length);
	if (body === '') return { endedLine, blocks: [] };
	return {
		endedLine,
		blocks: readBlocks(body + lineEnding, { grammar, scope: 'fragment' }).children
	};
}
