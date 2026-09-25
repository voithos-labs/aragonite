/**
 * Pure occurrence scan: indexing by word turns the caret-driven lookup into one map read
 * instead of a fresh document walk. Offsets are raw offsets within a block, dimmed markers
 * included, which is what mark decorations are measured in. Only prose blocks are scanned
 * (`isProseKind`), so a code, HTML or raw block is neither scanned nor a word to search for.
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
export const WORD_CHAR = /[\p{L}\p{N}_]/u;

export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

export type OccurrenceIndex = Map<string, MarkDecoration[]>;

/** Token lists keyed by the block `raw` they were scanned from, so a block whose bytes did
 *  not move costs one string compare instead of a re-tokenize. */
export type TokenCache = Map<string, WordSpan[]>;

export interface OccurrenceScan {
	index: OccurrenceIndex;
	/** Pass into the next scan; a block gone from the document drops out of it. */
	tokens: TokenCache;
	/** Blocks whose text had to be tokenized: what a caching test asserts on. */
	tokenizedLeaves: number;
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

/** Null when the selection's focus is not a block of text (a container or a table-cell
 *  endpoint), or the caret sits on a character that cannot start a word. */
export function anchorWord(doc: DocumentView, selection: EditorSelection | null): string | null {
	if (!selection) return null;
	const leaf = leafAt(doc, selection.focus.path);
	if (!leaf || !isProseKind(leaf.kind)) return null;
	const span = wordAt(leaf.raw, selection.focus.offset);
	return span ? span.word : null;
}

/** Built once per document change by a caching source, not once per caret move. The marks
 *  are rebuilt every time (they hold paths), the tokens only for blocks that changed. */
export function buildOccurrenceIndex(doc: DocumentView, cached?: TokenCache): OccurrenceScan {
	const index: OccurrenceIndex = new Map();
	const tokens: TokenCache = new Map();
	let tokenizedLeaves = 0;
	forEachLeaf(doc.children, [], (node, path) => {
		if (!isProseKind(node.kind)) return;
		let spans = tokens.get(node.raw) ?? cached?.get(node.raw);
		if (!spans) {
			spans = [...tokenizeWords(node.raw)];
			tokenizedLeaves++;
		}
		tokens.set(node.raw, spans);
		for (const span of spans) {
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
	return { index, tokens, tokenizedLeaves };
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
