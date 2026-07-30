/**
 * Inline-vs-structural paste strategy selection and blank-line materialization.
 */

import type { CstNode, Document } from '../../core/nodes';
import type { PasteStrategy } from './dispatch';
import { emptyParagraph } from '../node-ops';

export function pickPasteStrategy(parsed: Document): PasteStrategy {
	if (parsed.children.length === 1 && parsed.children[0].kind === 'paragraph') {
		return 'inline';
	}
	return 'structural';
}

/**
 * Convert blank-line trivia into explicit empty-paragraph blocks, so pasted
 * "one\n\ntwo" renders a visible blank-line row. The parser collapses blank
 * lines into leadingTrivia, which serializes the same but doesn't render as a
 * row. Top-level only — list items don't carry blank-line semantics in their
 * own trivia.
 *
 * This once matched what TYPING produced; it no longer does. Enter now separates
 * with a blank line the parser folds back into trivia, so paste is the one path
 * that materializes a row — the divergence the issues ledger tracks, not a
 * property to preserve.
 *
 * `lineEnding` is the TARGET document's, never the payload's: paste entry points
 * normalize the clipboard to LF, so the trivia these rows materialize from cannot
 * tell a CRLF document apart from an LF one (G4.20).
 */
export function materializeBlankLines(blocks: CstNode[], lineEnding: string): CstNode[] {
	if (blocks.length <= 1) return blocks;
	const out: CstNode[] = [blocks[0]];
	for (let i = 1; i < blocks.length; i++) {
		const block = blocks[i];
		const trivia = block.leadingTrivia ?? '';
		const newlineCount = (trivia.match(/\n/g) ?? []).length;
		if (newlineCount >= 1) {
			for (let j = 0; j < newlineCount; j++) {
				out.push(emptyParagraph('', lineEnding));
			}
			out.push({ ...block, leadingTrivia: '' });
		} else {
			out.push(block);
		}
	}
	return out;
}
