/**
 * The plugin-guide § Decorations "memoize the scan on editEpoch" recipe: the index costs a
 * document walk, so it is rebuilt only when the epoch bumps, carrying each leaf's token list
 * across the rebuild, and a caret move re-filters the cached index with one map read.
 * The marks step aside while you type: an epoch arriving under a caret with no `edit` event
 * ahead of it is a keystroke, and any edit event puts them back.
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
	/** Fires on each real index rebuild, carrying how many leaves that rebuild had to
	 *  tokenize: the seam a memoization test asserts against. */
	onScan?: (stats: { tokenizedLeaves: number }) => void;
}

export interface OccurrenceSource {
	readonly source: DecorationSource;
	setSelection(selection: EditorSelection | null): void;
	/**
	 * Report an `edit` op. Any of them ends the hold; only `input`, the batched flush that
	 * ends a typing burst, leaves the next epoch readable as another keystroke. Returns
	 * whether the caller must invalidate to reveal marks the hold was keeping back.
	 */
	noteEdit(op: string): boolean;
}

export function createOccurrenceSource(deps: OccurrenceSourceDeps = {}): OccurrenceSource {
	let selection: EditorSelection | null = null;
	let index: OccurrenceIndex = new Map();
	let tokens: TokenCache = new Map();
	// Sentinel below any real epoch, so the first provide always scans.
	let indexedEpoch = -1;
	let typing = false;
	// Nothing can have been typed into a source that has not run yet, so the first epoch it
	// ever sees is a document arrival however the caret sits.
	let structuralSinceScan = true;

	function provide(doc: DocumentView, { editEpoch }: ProvideContext): MarkDecoration[] {
		if (editEpoch !== indexedEpoch) {
			indexedEpoch = editEpoch;
			const scan = buildOccurrenceIndex(doc, tokens);
			index = scan.index;
			tokens = scan.tokens;
			deps.onScan?.({ tokenizedLeaves: scan.tokenizedLeaves });
			// A keystroke lands under a caret and says nothing on the edit channel until its
			// burst flushes. An epoch missing either mark is some other document change: a
			// commit that already announced itself, or a whole-document swap, which drops
			// the caret before its epoch arrives.
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
			// Undo bumps the content version before it emits, so a structural op can reach
			// here AFTER the epoch it moved: ending the hold here covers both orders.
			if (op !== 'input') structuralSinceScan = true;
			const held = typing;
			typing = false;
			return held;
		}
	};
}
