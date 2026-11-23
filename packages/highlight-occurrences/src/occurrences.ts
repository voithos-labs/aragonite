/**
 * The words of a block of prose, and the marks over the ones the caret's word repeats. A word is
 * read off the block's bytes, markers and destinations included, so offsets stay in those bytes;
 * a code, HTML or raw block is neither read nor a word to look for.
 */

import type { Block, Editor, Paint } from '@voithos-labs/aragonite/plugin';
import { WORD_CHAR } from './word-char';

/** The class every mark carries, under the editor's `decoration-overlay`. */
export const OCCURRENCE_CLASS = 'hl-occurrence';

export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

/** Prefers the char at the caret, falling back to the one before it (the usual
 *  word-under-caret rule). */
export function wordAt(text: string, offset: number): WordSpan | null {
	if (offset < 0 || offset > text.length) return null;
	let anchor = -1;
	if (offset < text.length && WORD_CHAR.test(text[offset])) anchor = offset;
	else if (offset > 0 && WORD_CHAR.test(text[offset - 1])) anchor = offset - 1;
	if (anchor < 0) return null;
	let start = anchor;
	while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
	let end = anchor + 1;
	while (end < text.length && WORD_CHAR.test(text[end])) end++;
	return { word: text.slice(start, end), start, end };
}

/** The word at the selection's head, in a block of prose; null for a selection over table cells
 *  or none, and for a head on no word. */
export function wordAtCaret(editor: Pick<Editor, 'selection' | 'blockAt'>): string | null {
	const selection = editor.selection;
	if (!selection || selection.cells) return null;
	const block = editor.blockAt(selection.head);
	if (!block?.prose) return null;
	const offset = block.offsetAt(selection.head);
	return offset === null ? null : (wordAt(block.text, offset)?.word ?? null);
}

/** A mark over each `word` in `block`, in document bytes. */
export function occurrenceMarks(block: Block, word: string): Paint[] {
	if (!block.prose) return [];
	const marks: Paint[] = [];
	for (const span of spansOf(block)) {
		if (span.word !== word) continue;
		// A word never crosses a line, so its bytes run on from its first.
		const from = block.byteAt(span.start);
		if (from < 0) continue;
		marks.push({ type: 'mark', from, to: from + span.word.length, class: OCCURRENCE_CLASS });
	}
	return marks;
}

// ── Internal ────────────────────────────────────────────────────────────────

// Kept per block while its bytes hold, so a caret moving to another word reads no text again.
const read = new WeakMap<Block, { text: string; spans: readonly WordSpan[] }>();

function spansOf(block: Block): readonly WordSpan[] {
	const { text } = block;
	const held = read.get(block);
	if (held?.text === text) return held.spans;
	const spans = [...tokenizeWords(text)];
	read.set(block, { text, spans });
	return spans;
}

function* tokenizeWords(text: string): Generator<WordSpan> {
	let i = 0;
	while (i < text.length) {
		if (!WORD_CHAR.test(text[i])) {
			i++;
			continue;
		}
		const start = i;
		while (i < text.length && WORD_CHAR.test(text[i])) i++;
		yield { word: text.slice(start, i), start, end: i };
	}
}
