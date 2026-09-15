/**
 * The plugin guide's § Decorations recipe, "cache the scan on editEpoch": building the index
 * costs a document walk, so it is rebuilt only when `editEpoch` changes, reusing each block's
 * token list, and a caret move re-filters the cached index with one map read. The marks step
 * aside while you type: an `editEpoch` arriving under a caret with no `edit` event before it
 * is a keystroke, and any edit event puts them back.
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
	/**
	 * Report an `edit` op. Any op turns the marks back on; only `input`, the batched flush at
	 * the end of a typing burst, leaves the next `editEpoch` readable as another keystroke.
	 * Returns whether the caller must invalidate to show marks that were being held back.
	 */
	noteEdit(op: string): boolean;
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
			// A keystroke happens under a caret and says nothing on the edit event until its
			// burst flushes. An `editEpoch` missing either sign is some other document change:
			// a commit that already announced itself, or a whole-document swap, which drops
			// the caret before its `editEpoch` arrives.
			typing = !structuralSinceScan && selection !== null;
			structuralSinceScan = false;
		}
		if (typing) return [];
		const word = anchorWord(doc, selection);
		return word ? (index.get(word) ?? []) : [];
	}

	return {
		source: { name: SOURCE_NAME, provide },
		setSelection(next) {
			selection = next;
		},
		noteEdit(op) {
			// Undo bumps the content version before it emits, so a structural op can arrive
			// after the `editEpoch` it caused; turning marks back on here covers both orders.
			if (op !== 'input') structuralSinceScan = true;
			const held = typing;
			typing = false;
			return held;
		}
	};
}
