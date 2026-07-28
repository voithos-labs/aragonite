/**
 * The selection-driven occurrence source, memoized on the edit epoch. The word
 * index is expensive (a whole-document walk); it is rebuilt only when the edit
 * epoch bumps, and a caret move re-filters the cached index with one map read.
 * This is the plugin-guide § Decorations "memoize the scan on editEpoch" recipe.
 */

import type {
	DecorationSource,
	DocumentView,
	EditorSelection,
	MarkDecoration,
	ProvideContext
} from '$lib/plugin';
import { anchorWord, buildOccurrenceIndex, type OccurrenceIndex } from './occurrences';

const SOURCE_NAME = 'highlight-occurrences';

export interface OccurrenceSourceDeps {
	/** Fires on each real index rebuild — the spy seam a memoization test asserts
	 *  against, and the observability hook the e2e harness publishes. */
	onScan?: () => void;
}

export interface OccurrenceSource {
	readonly source: DecorationSource;
	setSelection(selection: EditorSelection | null): void;
}

export function createOccurrenceSource(deps: OccurrenceSourceDeps = {}): OccurrenceSource {
	let selection: EditorSelection | null = null;
	let index: OccurrenceIndex = new Map();
	// The edit epoch this index was built for. Sentinel below any real epoch (0),
	// so the first provide always scans.
	let indexedEpoch = -1;

	function provide(doc: DocumentView, { editEpoch }: ProvideContext): MarkDecoration[] {
		if (editEpoch !== indexedEpoch) {
			indexedEpoch = editEpoch;
			index = buildOccurrenceIndex(doc);
			deps.onScan?.();
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
