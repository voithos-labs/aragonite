import type { DocumentView } from '../core/node-views';
import { buildRegexSpec, compileMatcher } from './matcher';
import { collectScanTargets, matchesFromRanges, scanDocument, type Match } from './document-scan';
import { createRegexExecutor, type RegexExecutor } from './regex-executor';
import { groupByPathKey, pathKey } from '../decorations/buckets';
import type { BlockSource } from '../decorations/block-paint';
import type { MarkDecoration } from '../decorations/types';

const EMPTY_MATCHES: IndexedMatch[] = [];
const NO_MARKS: readonly MarkDecoration[] = [];

// Both reuse the invalid-regex readout: a scan with no usable answer is one state to the
// user, whatever ended it.
const REGEX_TOO_SLOW = 'Regex too slow';
const REGEX_SCAN_FAILED = 'Regex search failed';

export interface SearchOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}

/** A match paired with its flat-list position, which the active highlight compares
 *  against `activeIndex`. */
export interface IndexedMatch {
	match: Match;
	index: number;
}

interface SearchDeps {
	getDoc: () => DocumentView;
	/** Bumped when the whole document is replaced, never on an in-place edit or undo,
	 *  since those leave the tree under a position the user still owns. */
	getDocumentGeneration: () => number;
	// Both resolve to the count actually replaced: the replace path may skip matches, so
	// the caller must not infer it.
	replace: {
		replaceOne(m: Match, t: string): Promise<number>;
		replaceAll(m: Match[], t: string): Promise<number>;
	};
	reveal: (path: number[]) => Promise<unknown>;
	/** Injected by tests; production builds the worker-backed executor internally. */
	regexExecutor?: RegexExecutor;
	// Returns focus to the document. Without it, closing removes the focused find input and
	// focus falls to <body>, stranding keyboard routing outside the editor.
	onClose: () => void;
}

export function createSearchState(deps: SearchDeps): EditorSearchState {
	let isOpen = $state(false);
	let query = $state('');
	let replacement = $state('');
	let options = $state<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false });
	let matches = $state<Match[]>([]);
	// One grouping per rescan, shared by every matchesForPath read.
	const matchesByPath = $derived(groupByPathKey(matches, (match, index) => ({ match, index })));
	let activeIndex = $state(0);
	let error = $state<string | null>(null);
	// Cleared on the next search action, not in rescan: the decoration registry's re-run
	// after a commit would otherwise wipe it instantly.
	let replacedCount = $state<number | null>(null);
	// A replace commits block by block, each in its own flush; the matches between are not final.
	let replacing = $state(false);

	// A regex scan lands asynchronously, so `matches` can trail its query: every rescan and close
	// bumps `scanEpoch`, and an outcome tagged with an older epoch is dropped.
	let scanning = $state(false);
	let scanEpoch = 0;
	let pendingScan: Promise<void> | null = null;
	const regexExecutor = deps.regexExecutor ?? createRegexExecutor();

	let lastGeneration = deps.getDocumentGeneration();

	// Counted by `documentChanged`, not read off `doc.children` identity: typing mutates the tree
	// in place, so identity changes only on a structural commit and would serve stale matches.
	let edits = 0;
	// The scan runs for its side effects, so only the current key may skip it; cleared on
	// close() so a reopen at the same key rescans rather than serving the empty set.
	let lastScanKey: string | null = null;

	// Synchronous, so setQuery's callers see fresh matches on return, even before open.
	function refresh(): void {
		const { caseSensitive, wholeWord, regex } = options;
		const key = `${edits}\0${+caseSensitive}${+wholeWord}${+regex}\0${query}`;
		if (key === lastScanKey) return;
		lastScanKey = key;
		rescan();
	}

	// Each block's highlights, read from its own matches while it renders.
	const highlights: BlockSource = {
		name: 'editor:search',
		decorationsOf(_node, path) {
			const own = matchesByPath.get(pathKey(path));
			if (!own) return NO_MARKS;
			const active = activeIndex;
			return own.map(({ match, index }): MarkDecoration => ({
				type: 'mark',
				path: match.path,
				start: match.start,
				end: match.end,
				class: index === active ? 'match-overlay match-overlay-active' : 'match-overlay'
			}));
		}
	};

	function rescan(doc: DocumentView = deps.getDoc()): void {
		// A whole-document replacement restarts navigation at the first match. Edits, undo and option
		// toggles keep the user's position through applyMatches' clamp.
		const generation = deps.getDocumentGeneration();
		const documentReplaced = generation !== lastGeneration;
		lastGeneration = generation;

		scanEpoch++;
		pendingScan = null;
		scanning = false;
		if (documentReplaced) activeIndex = 0;

		const r = compileMatcher(query, options);
		if (!r.ok) {
			failScan(r.error);
			return;
		}
		error = null;
		if (options.regex && query !== '') {
			startRegexScan(doc);
			return;
		}
		applyMatches(scanDocument(doc, r.matcher));
	}

	function applyMatches(found: Match[]): void {
		matches = found;
		if (activeIndex >= matches.length) activeIndex = 0;
	}

	function failScan(message: string): void {
		error = message;
		matches = [];
		activeIndex = 0;
	}

	// Regex is the only path that can run away, so the only one that leaves the main thread.
	// Matches clear at kickoff so stale overlays don't sit over the document mid-scan.
	function startRegexScan(doc: DocumentView): void {
		const epoch = scanEpoch;
		const targets = collectScanTargets(doc);
		const { pattern, flags } = buildRegexSpec(query, options);
		matches = [];
		scanning = true;
		pendingScan = regexExecutor
			.scan({ texts: targets.map((t) => t.raw), pattern, flags, epoch })
			.then((outcome) => {
				if (epoch !== scanEpoch) return; // a newer scan, or a close, owns the state now
				if (!outcome.ok && outcome.reason === 'cancelled') return;
				scanning = false;
				pendingScan = null;
				if (outcome.ok) applyMatches(matchesFromRanges(targets, outcome.ranges));
				else failScan(outcome.reason === 'timeout' ? REGEX_TOO_SLOW : REGEX_SCAN_FAILED);
			});
	}

	/** Walk the match list, wrapping at either end. */
	function step(delta: 1 | -1): void {
		replacedCount = null;
		refresh();
		if (!matches.length) return;
		activeIndex = (activeIndex + delta + matches.length) % matches.length;
		void revealActive();
	}

	async function commitReplace(write: () => Promise<number>): Promise<void> {
		replacing = true;
		try {
			const n = await write();
			// `documentChanged` waits for the flush, so the replaced bytes are scanned now.
			rescan();
			replacedCount = n;
		} finally {
			replacing = false;
		}
	}

	async function revealActive(): Promise<void> {
		await pendingScan; // a regex scan lands async; reveal the match we will actually show
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
		matchesForPath(path: readonly number[]): IndexedMatch[] {
			return matchesByPath.get(pathKey(path)) ?? EMPTY_MATCHES;
		},
		get activeIndex() {
			return activeIndex;
		},
		get error() {
			return error;
		},
		get isScanning() {
			return scanning;
		},
		get replacedCount() {
			return replacedCount;
		},
		open() {
			if (isOpen) return; // Ctrl+H over an open find bar keeps its matches
			isOpen = true;
			refresh();
		},
		close() {
			isOpen = false;
			matches = [];
			replacedCount = null;
			// Bump before releasing: a scan settling after close must find its epoch spent.
			scanEpoch++;
			scanning = false;
			pendingScan = null;
			regexExecutor.release();
			lastScanKey = null;
			deps.onClose();
		},
		setQuery(q: string) {
			// A new query restarts navigation; option toggles keep the position instead.
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
		next: () => step(1),
		prev: () => step(-1),
		async replaceCurrent() {
			await pendingScan; // regex matches land async; replacing needs the settled set
			const m = matches[activeIndex];
			if (!m) return;
			await commitReplace(() => deps.replace.replaceOne(m, replacement));
		},
		async replaceAll() {
			await pendingScan;
			if (!matches.length) return;
			await commitReplace(() => deps.replace.replaceAll(matches, replacement));
		},
		get highlights() {
			return isOpen ? highlights : null;
		},
		documentChanged() {
			edits++;
			if (isOpen) refresh();
		},
		viewKey() {
			if (scanning || replacing) return null;
			const { caseSensitive, wholeWord, regex } = options;
			const flags = `${+isOpen}${+caseSensitive}${+wholeWord}${+regex}`;
			return [flags, activeIndex, matches.length, error, replacedCount, query].join('\0');
		}
	};
}

/** The public search controller, what `editor.getSearch()` exposes. Deliberately minimal:
 *  adding a member later is non-breaking, removing one is not. */
export interface SearchState {
	readonly isOpen: boolean;
	readonly query: string;
	readonly replacement: string;
	readonly options: SearchOptions;
	readonly matches: Match[];
	/** Matches owned by `path`'s leaf, grouped once per rescan so readers skip the scan. */
	matchesForPath(path: readonly number[]): IndexedMatch[];
	readonly activeIndex: number;
	readonly error: string | null;
	/** True while a regex scan is off the main thread; literal search never sets it. */
	readonly isScanning: boolean;
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

/** The search state the editor holds: the public controller, plus the key `searchChange` compares. */
export interface EditorSearchState extends SearchState {
	/** Each block's match highlights while the bar is open, a reactive read; null while closed. */
	readonly highlights: BlockSource | null;
	/** Rescans an open bar after an edit, once the edit's flush is done. */
	documentChanged(): void;
	/** What a find bar shows, as one value; null while a regex scan or a replace is in flight, since
	 *  the matches it will show are not in yet. */
	viewKey(): string | null;
}
