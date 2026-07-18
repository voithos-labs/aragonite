import type { DocumentView } from '../core/node-views';
import { compileMatcher } from './matcher';
import { scanDocument, type Match } from './document-scan';
import { pathKey } from '../decorations/buckets';
import type {
	DecorationRegistry,
	DecorationSourceHandle,
	MarkDecoration,
	ProvideContext
} from '../decorations/types';
import { createBoundedMemo } from '../bounded-memo';

const EMPTY_MATCHES: IndexedMatch[] = [];

export interface SearchOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}

/** A match paired with its position in the flat `matches` list — the index the
 *  active-highlight compares against `activeIndex`. */
export interface IndexedMatch {
	match: Match;
	index: number;
}

interface SearchDeps {
	getDoc: () => DocumentView;
	/** Highlights ship as mark decorations under source 'editor:search' —
	 *  registered on open, disposed on close, so a closed bar costs nothing. */
	decorations: DecorationRegistry;
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

export function createSearchState(deps: SearchDeps): SearchState {
	let isOpen = $state(false);
	let query = $state('');
	let replacement = $state('');
	let options = $state<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false });
	let matches = $state<Match[]>([]);
	// One grouping per rescan, shared by every matchesForPath read.
	const matchesByPath = $derived(groupByPath(matches));
	let activeIndex = $state(0);
	let error = $state<string | null>(null);
	// Count of the last replace/replaceAll, surfaced as "N replaced" feedback.
	// Cleared on the next search ACTION, not in rescan — the engine's post-commit
	// re-run would otherwise wipe it instantly.
	let replacedCount = $state<number | null>(null);

	let handle: DecorationSourceHandle | null = null;

	// The scan runs for its side effects (matches/error/activeIndex), so only the
	// CURRENT key may ever hit — a deeper cache could hit an older key (an option
	// toggled back, say) whose side effects no longer hold. Hence cap 1. Re-minted
	// on close(), which clears `matches`: the last key's cached side effect no
	// longer holds, so reopen (same key) must miss and rescan, not serve the empty set.
	let scanMemo = createBoundedMemo<string, null>({ cap: 1 });

	// Keyed on editEpoch + query + options — NEVER doc.children identity: routine
	// typing mutates children in place, so identity only changes on structural
	// commits and would serve stale matches while typing. notifyEdit bumps the
	// epoch (edit → miss → rescan); invalidate leaves it (navigation → hit →
	// active-class remap only).
	function provide(_doc: DocumentView, ctx: ProvideContext): MarkDecoration[] {
		const { caseSensitive, wholeWord, regex } = options;
		scanMemo(`${ctx.editEpoch}\0${+caseSensitive}${+wholeWord}${+regex}\0${query}`, () => {
			rescan();
			return null;
		});
		return matches.map(
			(m, i): MarkDecoration => ({
				type: 'mark',
				path: m.path,
				start: m.start,
				end: m.end,
				class: i === activeIndex ? 'match-overlay match-overlay-active' : 'match-overlay'
			})
		);
	}

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

	// Every state change routes through the engine so the published marks follow.
	// invalidate is synchronous by contract, so setQuery's callers still observe
	// fresh matches on return; the no-handle fallback keeps the headless
	// setQuery-before-open path scanning as it always has.
	function refresh(): void {
		if (handle) handle.invalidate();
		else rescan();
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
			if (isOpen) return; // Ctrl+H over an open find bar reuses the live source
			isOpen = true;
			handle = deps.decorations.addSource({ name: 'editor:search', provide });
		},
		close() {
			isOpen = false;
			handle?.dispose();
			handle = null;
			matches = [];
			replacedCount = null;
			scanMemo = createBoundedMemo<string, null>({ cap: 1 });
			deps.onClose();
		},
		setQuery(q: string) {
			// A new query restarts navigation at the first match; option toggles
			// (setOptions) keep the position through the rescan clamp instead.
			if (q !== query) activeIndex = 0;
			query = q;
			replacedCount = null;
			refresh();
			void revealActive();
		},
		setReplacement(s: string) {
			replacement = s;
		},
		setOptions(partial: Partial<SearchOptions>) {
			options = { ...options, ...partial };
			replacedCount = null;
			refresh();
			void revealActive();
		},
		next() {
			replacedCount = null;
			if (matches.length) {
				activeIndex = (activeIndex + 1) % matches.length;
				refresh();
				void revealActive();
			}
		},
		prev() {
			replacedCount = null;
			if (matches.length) {
				activeIndex = (activeIndex - 1 + matches.length) % matches.length;
				refresh();
				void revealActive();
			}
		},
		async replaceCurrent() {
			const m = matches[activeIndex];
			if (!m) return;
			const n = await deps.replace.replaceOne(m, replacement);
			// The edit-epoch bump is deferred, so an invalidate-only refresh would
			// hit the memo and republish the pre-replace matches; rescan first so
			// the memo hit maps the fresh set.
			rescan();
			refresh();
			replacedCount = n;
		},
		async replaceAll() {
			if (!matches.length) return;
			const n = await deps.replace.replaceAll(matches, replacement);
			rescan();
			refresh();
			replacedCount = n;
		}
	};
}

function groupByPath(list: readonly Match[]): Map<string, IndexedMatch[]> {
	const byPath = new Map<string, IndexedMatch[]>();
	list.forEach((match, index) => {
		const key = pathKey(match.path);
		const bucket = byPath.get(key);
		if (bucket) bucket.push({ match, index });
		else byPath.set(key, [{ match, index }]);
	});
	return byPath;
}

/** Public controller surface — what `editor.getSearch()` exposes. Deliberately
 *  minimal: adding a public member later is non-breaking, removing one is
 *  breaking. createSearchState's declared return type pins the runtime to it. */
export interface SearchState {
	readonly isOpen: boolean;
	readonly query: string;
	readonly replacement: string;
	readonly options: SearchOptions;
	readonly matches: Match[];
	/** Matches owned by `path`'s leaf, with their flat index — grouped once per
	 *  rescan so readers skip the full-document scan. */
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
