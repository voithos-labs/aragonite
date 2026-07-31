/**
 * Pure occurrence scan: indexing by word is what turns the caret-driven lookup into
 * one map read rather than a fresh document walk. Offsets are per-leaf raw offsets,
 * dimmed markers included, the space mark decorations consume. `isProseKind` gates the
 * scope, so a code/HTML/raw leaf is neither scanned nor a valid anchor.
 */

import {
	isProseKind,
	type DocumentView,
	type EditorSelection,
	type MarkDecoration,
	type NodeView
} from '$lib/plugin';

export const OCCURRENCE_CLASS = 'hl-occurrence';

// Astral-plane text falls outside "word" here, which is honest enough for a reference plugin.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

export type OccurrenceIndex = Map<string, MarkDecoration[]>;

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

/** Null when the focus is not a leaf (a container/cell-coordinate endpoint) or the
 *  caret sits on a non-word char. */
export function anchorWord(doc: DocumentView, selection: EditorSelection | null): string | null {
	if (!selection) return null;
	const leaf = leafAt(doc, selection.focus.path);
	if (!leaf || !isProseKind(leaf.kind)) return null;
	const span = wordAt(leaf.raw, selection.focus.offset);
	return span ? span.word : null;
}

/** Built once per edit by a memoizing source, not once per caret move. */
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
