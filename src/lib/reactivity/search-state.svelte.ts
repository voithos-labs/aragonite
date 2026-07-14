import type { Document } from '../core/nodes';
import { compileMatcher } from '../search/matcher';
import { scanDocument, type Match } from '../search/document-scan';
import {
	groupMatchesByAncestor,
	groupMatchesByPath,
	pathKey,
	type IndexedMatch
} from '../search/match-index';

const EMPTY_MATCHES: IndexedMatch[] = [];

export interface SearchOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}
interface SearchDeps {
	getDoc: () => Document;
	// Both resolve to the count actually replaced — the replace path may skip
	// matches (childless opaque containers), so the caller must not infer it.
	replace: {
		replaceOne(m: Match, t: string): Promise<number>;
		replaceAll(m: Match[], t: string): Promise<number>;
	};
	reveal: (path: number[]) => Promise<unknown>;
	// Closing unmounts the bar; without this the focused find input is removed and
	// focus falls to <body>, stranding keyboard routing (undo, cross-block) outside
	// the editor. Returns focus to the document.
	onClose: () => void;
}

export function createSearchState(deps: SearchDeps) {
	let isOpen = $state(false);
	let query = $state('');
	let replacement = $state('');
	let options = $state<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false });
	let matches = $state<Match[]>([]);
	// One grouping per rescan, shared by every overlay — see match-index. The
	// ancestor index is lazy ($derived): docs without grid surfaces never build it.
	const matchesByPath = $derived(groupMatchesByPath(matches));
	const matchesByAncestor = $derived(groupMatchesByAncestor(matches));
	let activeIndex = $state(0);
	let error = $state<string | null>(null);
	// Count of the last replace/replaceAll, surfaced as "N replaced" feedback.
	// Cleared on the next search ACTION (not in rescan — see Editor.svelte's
	// post-commit rescan, which would otherwise wipe it instantly).
	let replacedCount = $state<number | null>(null);

	function rescan(): void {
		const r = compileMatcher(query, options);
		if (!r.ok) {
			error = r.error;
			matches = [];
			activeIndex = 0;
			return;
		}
		error = null;
		matches = scanDocument(deps.getDoc(), r.matcher);
		if (activeIndex >= matches.length) activeIndex = 0;
	}

	async function revealActive(): Promise<void> {
		const m = matches[activeIndex];
		if (m) await deps.reveal(m.path);
	}

	return {
		get isOpen() {
			return isOpen;
		},
		get query() {
			return query;
		},
		get replacement() {
			return replacement;
		},
		get options() {
			return options;
		},
		get matches() {
			return matches;
		},
		matchesForPath(path: number[]): IndexedMatch[] {
			return matchesByPath.get(pathKey(path)) ?? EMPTY_MATCHES;
		},
		// Grid-overlay seam (cells have no BlockHost overlay of their own).
		// Deliberately off the public SearchState interface — see its note.
		matchesForDescendants(path: number[]): IndexedMatch[] {
			return matchesByAncestor.get(pathKey(path)) ?? EMPTY_MATCHES;
		},
		get activeIndex() {
			return activeIndex;
		},
		get error() {
			return error;
		},
		get replacedCount() {
			return replacedCount;
		},
		open() {
			isOpen = true;
		},
		close() {
			isOpen = false;
			matches = [];
			replacedCount = null;
			deps.onClose();
		},
		setQuery(q: string) {
			// A new query restarts navigation at the first match; option toggles
			// (setOptions) keep the position through the rescan clamp instead.
			if (q !== query) activeIndex = 0;
			query = q;
			replacedCount = null;
			rescan();
			void revealActive();
		},
		setReplacement(s: string) {
			replacement = s;
		},
		setOptions(partial: Partial<SearchOptions>) {
			options = { ...options, ...partial };
			replacedCount = null;
			rescan();
			void revealActive();
		},
		next() {
			replacedCount = null;
			if (matches.length) {
				activeIndex = (activeIndex + 1) % matches.length;
				void revealActive();
			}
		},
		prev() {
			replacedCount = null;
			if (matches.length) {
				activeIndex = (activeIndex - 1 + matches.length) % matches.length;
				void revealActive();
			}
		},
		revealActive,
		async replaceCurrent() {
			const m = matches[activeIndex];
			if (!m) return;
			const n = await deps.replace.replaceOne(m, replacement);
			rescan();
			replacedCount = n;
		},
		async replaceAll() {
			if (!matches.length) return;
			const n = await deps.replace.replaceAll(matches, replacement);
			rescan();
			replacedCount = n;
		},
		rescan
	};
}
/** Full runtime surface, including internal-only seams the public SearchState
 *  omits. Internal components type the search context with this. */
export type InternalSearchState = ReturnType<typeof createSearchState>;

/** Public controller surface — what `editor.getSearch()` exposes. The runtime's
 *  internal-only seams are deliberately omitted: adding a public member later is
 *  non-breaking, removing one is breaking, so keep this minimal. */
export interface SearchState {
	readonly isOpen: boolean;
	readonly query: string;
	readonly replacement: string;
	readonly options: SearchOptions;
	readonly matches: Match[];
	/** Matches owned by `path`'s leaf, with their flat index — grouped once per
	 *  rescan so overlays skip the full-document scan. */
	matchesForPath(path: number[]): IndexedMatch[];
	readonly activeIndex: number;
	readonly error: string | null;
	readonly replacedCount: number | null;
	open(): void;
	close(): void;
	setQuery(q: string): void;
	setReplacement(s: string): void;
	setOptions(partial: Partial<SearchOptions>): void;
	next(): void;
	prev(): void;
	replaceCurrent(): Promise<void>;
	replaceAll(): Promise<void>;
}
