/**
 * The plugin-guide § Decorations "memoize the scan on editEpoch" recipe: the index costs a
 * document walk, so it is rebuilt only when the epoch bumps, carrying each leaf's token list
 * across the rebuild, and a caret move re-filters the cached index with one map read.
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
}

export function createOccurrenceSource(deps: OccurrenceSourceDeps = {}): OccurrenceSource {
	let selection: EditorSelection | null = null;
	let index: OccurrenceIndex = new Map();
	let tokens: TokenCache = new Map();
	// Sentinel below any real epoch, so the first provide always scans.
	let indexedEpoch = -1;

	function provide(doc: DocumentView, { editEpoch }: ProvideContext): MarkDecoration[] {
		if (editEpoch !== indexedEpoch) {
			indexedEpoch = editEpoch;
			const scan = buildOccurrenceIndex(doc, tokens);
			index = scan.index;
			tokens = scan.tokens;
			deps.onScan?.({ tokenizedLeaves: scan.tokenizedLeaves });
		}
		const word = anchorWord(doc, selection);
		return word ? (index.get(word) ?? []) : [];
	}

	return {
		source: { name: SOURCE_NAME, provide },
		setSelection(next) {
			selection = next;
		}
	};
}
