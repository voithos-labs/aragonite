/**
 * Pure occurrence scan for the highlight-occurrences plugin. Tokenizes each prose
 * leaf into whole words and indexes every occurrence by word, so a selection-driven
 * source looks up the word under the caret with one map read instead of a fresh
 * whole-document walk. Offsets are per-leaf raw offsets (dimmed markers included)
 * — the coordinate space mark decorations consume.
 *
 * Only inline-prose leaves are in scope, gated by `isProseKind` (the descriptor's
 * `supportsInline` — paragraph/heading/table-cell, the surfaces this feature paints).
 * Occurrence highlighting is an inline-prose feature, so a code/HTML/raw leaf is
 * neither scanned nor a valid anchor — the same capability gate footnote numbering
 * uses to keep a code block's bytes out of an inline walk.
 */

import {
	isProseKind,
	type DocumentView,
	type EditorSelection,
	type MarkDecoration,
	type NodeView
} from '$lib/plugin';

export const OCCURRENCE_CLASS = 'hl-occurrence';

// BMP letters/digits/underscore; astral-plane text falls outside "word" here,
// which is honest enough for a reference plugin.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

/** Word → every whole-word occurrence of it across the document, as ready-to-paint
 *  marks in document order. */
export type OccurrenceIndex = Map<string, MarkDecoration[]>;

/** The word containing `offset`, preferring the char at the caret and falling
 *  back to the char before it (the usual word-under-caret rule). */
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

/** The whole word to highlight for a selection: the word under the caret. Null
 *  when the focus is not a leaf (a container/cell-coordinate endpoint) or the
 *  caret sits on a non-word char. */
export function anchorWord(doc: DocumentView, selection: EditorSelection | null): string | null {
	if (!selection) return null;
	const leaf = leafAt(doc, selection.focus.path);
	if (!leaf || !isProseKind(leaf.kind)) return null;
	const span = wordAt(leaf.raw, selection.focus.offset);
	return span ? span.word : null;
}

/** Index every whole-word occurrence across the document's leaves. Built once per
 *  edit by a memoizing source; the caret-driven lookup is then a single map read. */
export function buildOccurrenceIndex(doc: DocumentView): OccurrenceIndex {
	const index: OccurrenceIndex = new Map();
	forEachLeaf(doc.children, [], (node, path) => {
		if (!isProseKind(node.kind)) return;
		for (const span of tokenizeWords(node.raw)) {
			const mark: MarkDecoration = {
				type: 'mark',
				path,
				start: span.start,
				end: span.end,
				class: OCCURRENCE_CLASS
			};
			const bucket = index.get(span.word);
			if (bucket) bucket.push(mark);
			else index.set(span.word, [mark]);
		}
	});
	return index;
}

// ── Internal ────────────────────────────────────────────────────────────────

function leafAt(doc: DocumentView, path: number[]): NodeView | null {
	let children: readonly NodeView[] | undefined = doc.children;
	let node: NodeView | null = null;
	for (const index of path) {
		node = children?.[index] ?? null;
		if (!node) return null;
		children = node.children;
	}
	return node && !node.children ? node : null;
}

function forEachLeaf(
	children: readonly NodeView[],
	path: number[],
	visit: (node: NodeView, path: number[]) => void
): void {
	for (let i = 0; i < children.length; i++) {
		const node = children[i];
		const childPath = [...path, i];
		if (node.children) forEachLeaf(node.children, childPath, visit);
		else visit(node, childPath);
	}
}

/** Maximal runs of word chars, each a whole-word occurrence. */
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
