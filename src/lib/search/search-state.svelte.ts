import type { DocumentView } from '../core/node-views';
import { buildRegexSpec, compileMatcher } from './matcher';
import { collectScanTargets, matchesFromRanges, scanDocument, type Match } from './document-scan';
import { createRegexExecutor, type RegexExecutor } from './regex-executor';
import { groupByPathKey, pathKey } from '../decorations/buckets';
import type {
	DecorationRegistry,
	DecorationSourceHandle,
	MarkDecoration,
	ProvideContext
} from '../decorations/types';
import { createBoundedMemo } from '../bounded-memo';

const EMPTY_MATCHES: IndexedMatch[] = [];

// Both reuse the invalid-regex readout: a scan that produced no usable answer is
// one state to the reader, whatever ended it.
const REGEX_TOO_SLOW = 'Regex too slow';
const REGEX_SCAN_FAILED = 'Regex search failed';

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
	/** Bumped when the whole document is REPLACED (a `source` prop swap), never on
	 *  an in-place edit and never on undo — both of those reassign or mutate the
	 *  tree under a position the user still owns. */
	getDocumentGeneration: () => number;
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
	/** Test seam. Production builds the worker-backed executor internally; a suite
	 *  that needs a deadline it can reach, or a scan it can fail on demand, supplies
	 *  its own. */
	regexExecutor?: RegexExecutor;
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

	// A regex scan lands asynchronously, so `matches` can be a scan behind the query
	// that asked for it. `scanEpoch` is the drop token: every rescan (and close)
	// bumps it, and an outcome tagged with a spent epoch is discarded.
	let scanning = $state(false);
	let scanEpoch = 0;
	let pendingScan: Promise<void> | null = null;
	const regexExecutor = deps.regexExecutor ?? createRegexExecutor();

	let lastGeneration = deps.getDocumentGeneration();

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
	function provide(doc: DocumentView, ctx: ProvideContext): MarkDecoration[] {
		const { caseSensitive, wholeWord, regex } = options;
		scanMemo(`${ctx.editEpoch}\0${+caseSensitive}${+wholeWord}${+regex}\0${query}`, () => {
			// Scan the document the registry is providing FOR, not whatever the deps
			// getter resolves to. The two agree today; a source reading its own getter
			// instead of its argument is the shape this file would be teaching, since
			// the plugin guide points decoration authors here.
			rescan(doc);
			return null;
		});
		return matches.map((m, i): MarkDecoration => ({
			type: 'mark',
			path: m.path,
			start: m.start,
			end: m.end,
			class: i === activeIndex ? 'match-overlay match-overlay-active' : 'match-overlay'
		}));
	}

	function rescan(doc: DocumentView = deps.getDoc()): void {
		// A whole-document REPLACEMENT restarts navigation at the first match, the way
		// a new query does: the carried position indexes a document the user never
		// navigated. In-place edits, undo and option toggles keep it — they leave the
		// user where they were — so those fall through to the clamp in applyMatches.
		const generation = deps.getDocumentGeneration();
		const documentReplaced = generation !== lastGeneration;
		lastGeneration = generation;

		scanEpoch++;
		pendingScan = null;
		scanning = false;
		if (documentReplaced) activeIndex = 0;

		const r = compileMatcher(query, options);
		if (!r.ok) {
			error = r.error;
			matches = [];
			activeIndex = 0;
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

	// Regex is the only path that can run away, so it is the only one that leaves
	// the main thread. Matches clear at kickoff: overlays from the query being
	// replaced must not sit over the document while the new scan runs.
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
				// invalidate, not refresh(): refresh's no-handle fallback re-runs rescan,
				// which would start a second scan from inside this one's completion.
				handle?.invalidate();
			});
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
		matchesForPath(path: number[]): IndexedMatch[] {
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
			// Bump before releasing: a scan settling after close must find its epoch
			// spent and write nothing onto a bar that is gone.
			scanEpoch++;
			scanning = false;
			pendingScan = null;
			regexExecutor.release();
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
			await pendingScan; // regex matches land async; replacing needs the settled set
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
			await pendingScan;
			if (!matches.length) return;
			const n = await deps.replace.replaceAll(matches, replacement);
			rescan();
			refresh();
			replacedCount = n;
		}
	};
}

function groupByPath(list: readonly Match[]): Map<string, IndexedMatch[]> {
	return groupByPathKey(list, (match, index) => ({ match, index }));
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
	/** True while a regex scan is off the main thread. Literal search is synchronous
	 *  and never sets it. */
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
