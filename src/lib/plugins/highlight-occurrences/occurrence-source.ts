/**
 * The occurrence mark source: the word index is rebuilt only when `editEpoch` changes, and a caret
 * move is one map read. The marks hide while you type: an `editEpoch` that no structural `edit` or
 * `sourceSwap` announced is a keystroke, and either event, or a pause in the typing, shows them again.
 */

import type {
	DecorationSource,
	DocumentView,
	EditorSelection,
	MarkDecoration,
	ProvideContext
} from '$lib/plugin';
import {
	anchorWord,
	buildOccurrenceIndex,
	type OccurrenceIndex,
	type TokenCache
} from './occurrences';

const SOURCE_NAME = 'highlight-occurrences';

export interface OccurrenceSourceDeps {
	/** Fires on each real index rebuild, with how many blocks that rebuild had to tokenize:
	 *  what a caching test asserts on. */
	onScan?: (stats: { tokenizedLeaves: number }) => void;
}

export interface OccurrenceSource {
	readonly source: DecorationSource;
	setSelection(selection: EditorSelection | null): void;
	/** Report an `edit` op: `input` is a keystroke, which leaves its `editEpoch` hidden, and any
	 *  other op shows the marks again. Returns whether the caller must invalidate. */
	noteEdit(op: string): boolean;
	/** Report that typing paused: the marks show again. Returns whether the caller must invalidate. */
	noteTypingPause(): boolean;
	/** Report a `sourceSwap`: the next `editEpoch` is the new document, never a keystroke.
	 *  Returns whether the caller must invalidate, as `noteEdit` does. */
	noteSourceSwap(): boolean;
}

export function createOccurrenceSource(deps: OccurrenceSourceDeps = {}): OccurrenceSource {
	let selection: EditorSelection | null = null;
	let index: OccurrenceIndex = new Map();
	let tokens: TokenCache = new Map();
	// Below any real `editEpoch`, so the first call always scans.
	let indexedEpoch = -1;
	let typing = false;
	// Nothing can have been typed into a source that has not run yet, so the first `editEpoch`
	// it ever sees is the document arriving, wherever the caret is.
	let structuralSinceScan = true;

	function provide(doc: DocumentView, { editEpoch }: ProvideContext): MarkDecoration[] {
		if (editEpoch !== indexedEpoch) {
			indexedEpoch = editEpoch;
			const scan = buildOccurrenceIndex(doc, tokens);
			index = scan.index;
			tokens = scan.tokens;
			deps.onScan?.({ tokenizedLeaves: scan.tokenizedLeaves });
			// A keystroke announces only `input`; every other document change announced a
			// structural op or a swap before its `editEpoch` arrived.
			typing = !structuralSinceScan;
			structuralSinceScan = false;
		}
		if (typing) return [];
		const word = anchorWord(doc, selection);
		return word ? (index.get(word) ?? []) : [];
	}

	function showMarks(): boolean {
		const held = typing;
		typing = false;
		return held;
	}

	return {
		source: { name: SOURCE_NAME, provide },
		setSelection(next) {
			selection = next;
		},
		noteEdit(op) {
			if (op === 'input') return false;
			structuralSinceScan = true;
			// A replace-all names its op after its commits' epochs, which may have hidden the marks.
			return showMarks();
		},
		noteTypingPause: showMarks,
		noteSourceSwap() {
			structuralSinceScan = true;
			return showMarks();
		}
	};
}
