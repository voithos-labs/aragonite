/**
 * Pure occurrence scan for the highlight-occurrences dogfood: the word under
 * the caret, and a mark on every whole-word occurrence of it across the
 * document's leaf blocks. Offsets are per-leaf raw offsets (dimmed markers
 * included) — the coordinate space mark decorations consume.
 */

import type { DocumentView, MarkDecoration, NodeView, EditorSelection } from '$lib/plugin';

export const OCCURRENCE_CLASS = 'hl-occurrence';

// BMP letters/digits/underscore; astral-plane text falls outside "word" here,
// which is honest enough for a reference dogfood.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

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

export function occurrenceMarks(
	doc: DocumentView,
	selection: EditorSelection | null
): MarkDecoration[] {
	if (!selection) return [];
	const leaf = leafAt(doc, selection.focus.path);
	if (!leaf) return [];
	const span = wordAt(leaf.raw, selection.focus.offset);
	if (!span) return [];

	const marks: MarkDecoration[] = [];
	forEachLeaf(doc.children, [], (node, path) => {
		for (const occurrence of wholeWordSpans(node.raw, span.word)) {
			marks.push({
				type: 'mark',
				path,
				start: occurrence.start,
				end: occurrence.end,
				class: OCCURRENCE_CLASS
			});
		}
	});
	return marks;
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

function wholeWordSpans(text: string, word: string): { start: number; end: number }[] {
	const spans: { start: number; end: number }[] = [];
	for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + word.length)) {
		const before = i > 0 ? text[i - 1] : '';
		const after = i + word.length < text.length ? text[i + word.length] : '';
		if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) {
			spans.push({ start: i, end: i + word.length });
		}
	}
	return spans;
}
