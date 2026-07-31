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
 * Convert blank-line trivia into explicit empty-paragraph blocks (top-level only), so a
 * pasted blank line renders as a visible row: the parser collapses blanks into
 * `leadingTrivia`, which serializes the same but does not render. Paste is the only path
 * that materializes a row — a known asymmetry with typing, not a property to preserve.
 * `lineEnding` is the TARGET document's: entry points normalize the clipboard to LF (G4.20).
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
