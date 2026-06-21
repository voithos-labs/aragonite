import type { Document } from '../core/nodes';
import { compileMatcher } from '../search/matcher';
import { scanDocument, type Match } from '../search/document-scan';

export interface SearchOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}
interface SearchDeps {
	getDoc: () => Document;
	replace: {
		replaceOne(m: Match, t: string): Promise<void>;
		replaceAll(m: Match[], t: string): Promise<void>;
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
	let activeIndex = $state(0);
	let error = $state<string | null>(null);

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
		if (activeIndex >= matches.length) activeIndex = 0; // clamp when the set shrank
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
		get activeIndex() {
			return activeIndex;
		},
		get error() {
			return error;
		},
		open() {
			isOpen = true;
		},
		close() {
			isOpen = false;
			matches = [];
			deps.onClose();
		},
		setQuery(q: string) {
			query = q;
			rescan();
		},
		setReplacement(s: string) {
			replacement = s;
		},
		setOptions(partial: Partial<SearchOptions>) {
			options = { ...options, ...partial };
			rescan();
		},
		next() {
			if (matches.length) {
				activeIndex = (activeIndex + 1) % matches.length;
				void revealActive();
			}
		},
		prev() {
			if (matches.length) {
				activeIndex = (activeIndex - 1 + matches.length) % matches.length;
				void revealActive();
			}
		},
		revealActive,
		async replaceCurrent() {
			const m = matches[activeIndex];
			if (!m) return;
			await deps.replace.replaceOne(m, replacement);
			rescan();
		},
		async replaceAll() {
			if (!matches.length) return;
			await deps.replace.replaceAll(matches, replacement);
			rescan();
		},
		rescan
	};
}
/** Public controller surface — what `editor.getSearch()` exposes. Internal-only
 *  members (`rescan`, `revealActive`) are deliberately omitted: adding a public
 *  member later is non-breaking, removing one is breaking, so keep this minimal. */
export interface SearchState {
	readonly isOpen: boolean;
	readonly query: string;
	readonly replacement: string;
	readonly options: SearchOptions;
	readonly matches: Match[];
	readonly activeIndex: number;
	readonly error: string | null;
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
