/** One editor's decoration sources, their merged results, and the per-path lookups the
 *  overlays and inline widgets read. A source never runs inside a commit. */
import { isDevChecks } from '../env';
import { tick } from 'svelte';
import type { DocumentView, NodeView } from '../core/node-views';
import {
	groupDecorationsByAncestor,
	groupDecorationsByPath,
	pathKey,
	type IndexedDecoration
} from './buckets';
import { islandPosition } from './island-dom';
import type {
	BlockDecoration,
	Decoration,
	DecorationSource,
	DecorationSourceHandle,
	MarkDecoration,
	ReplaceDecoration,
	WidgetDecoration
} from './types';
import { assertInvariant } from '../assert';
import { isCommitInProgress } from '../invariants/commit-scope';
import { contentLengthOf, isProseKind } from '../core/inline';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { devWarn } from '../dev-warn';
import { recordDecorationRun } from '../perf/instruments';

const EMPTY_MARKS: IndexedDecoration<MarkDecoration>[] = [];
const EMPTY_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];
const EMPTY_BLOCKS: BlockDecoration[] = [];

export interface DecorationEngineDeps {
	getDoc: () => DocumentView;
	onSourceError?: (sourceName: string, error: unknown) => void;
}

export type DecorationEngine = {
	addSource(source: DecorationSource): DecorationSourceHandle; // dup name throws
	readonly sourceCount: number;
	/** Bump the edit counter, then re-run every source's `provide`. `handle.invalidate()`
	 *  re-runs one source without the bump, which is what lets a memoized source tell "the
	 *  document changed" from "my own state changed". */
	notifyEdit(): void;
	marksForPath(path: number[]): IndexedDecoration<MarkDecoration>[];
	marksForDescendants(path: number[]): IndexedDecoration<MarkDecoration>[];
	islandsForPath(path: number[]): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	blockDecorationsForPath(path: number[]): BlockDecoration[];
};

export function createDecorationEngine(deps: DecorationEngineDeps): DecorationEngine {
	// Non-reactive registry state, lined up with `results` by index. A handle closes over the
	// source object, not its index, so disposing one never leaves another pointing at the wrong
	// entry.
	const sources: DecorationSource[] = [];
	const names = new Set<string>();
	const warnedUnrenderableIslands = new Set<string>();
	let results = $state<Decoration[][]>([]);
	// Deliberately not reactive: an `invalidate()` that reads it must not schedule a recompute
	// of the derived buckets.
	let editEpoch = 0;

	const merged = $derived(results.flat());
	const byPath = $derived(groupDecorationsByPath(merged));
	const byAncestor = $derived(groupDecorationsByAncestor(merged));

	function runSource(source: DecorationSource): void {
		const i = sources.indexOf(source);
		if (i < 0) return; // disposed between schedule and run
		recordDecorationRun();
		let next: Decoration[];
		try {
			next = source.provide(deps.getDoc(), { editEpoch });
		} catch (error) {
			deps.onSourceError?.(source.name, error);
			return; // keep the source's previous decorations; a throw never blanks the view
		}
		warnUnrenderableIslands(source.name, next);
		// A re-run that was empty and stays empty must not reassign `results`, or every keystroke
		// would rebuild the derived buckets for sources that never emit anything.
		if (results[i].length === 0 && next.length === 0) return;
		const copy = results.slice();
		copy[i] = next;
		results = copy;
	}

	/** Why the render path will apply nothing for this inline widget, or null when it will.
	 *  Asked here because only this pass sees the decoration beside the document it came from. */
	function islandDefect(
		dec: WidgetDecoration | ReplaceDecoration,
		node: NodeView
	): { key: string; message: string } | null {
		// Non-prose kinds run no inline pass, so they apply no inline widgets.
		if (!isProseKind(node.kind)) {
			return {
				key: `non-prose\0${node.kind}`,
				message: `on a non-prose ${node.kind} block; decorations render only in prose blocks`
			};
		}
		// An end offset, not a count: a heading's content starts past its marker, so reporting a
		// byte total would name a number the author cannot place anything at.
		const contentEnd = contentLengthOf(node);
		const held = `the block's content ends at ${contentEnd}`;
		if (dec.type === 'widget') {
			if (dec.offset >= 0 && dec.offset <= contentEnd) return null;
			return { key: 'range', message: `at offset ${dec.offset}, but ${held}` };
		}
		if (dec.start >= 0 && dec.start < dec.end && dec.end <= contentEnd) return null;
		return { key: 'range', message: `at ${dec.start}..${dec.end}, but ${held}` };
	}

	function warnUnrenderableIslands(sourceName: string, decs: Decoration[]): void {
		if (!isDevChecks()) return;
		const doc = deps.getDoc();
		for (const dec of decs) {
			if (dec.type !== 'widget' && dec.type !== 'replace') continue;
			const node = nodeAt(doc, dec.path);
			if (!node || !isBlockNode(node)) continue;
			const defect = islandDefect(dec, node);
			if (!defect) continue;
			const key = `${sourceName}\0${defect.key}`;
			if (warnedUnrenderableIslands.has(key)) continue;
			warnedUnrenderableIslands.add(key);
			devWarn(
				'decorations',
				`source '${sourceName}' places a ${dec.type} decoration ${defect.message}`,
				{ path: dec.path }
			);
		}
	}

	// A source that invalidates from its own `edit` handler is asking to re-run inside the
	// commit that emitted the event; deferred to one run per source once the commit is done.
	const deferred = new Set<DecorationSource>();
	let flushQueued = false;

	function runAfterCommit(source: DecorationSource): void {
		deferred.add(source);
		if (flushQueued) return;
		flushQueued = true;
		void tick().then(() => {
			flushQueued = false;
			const pending = [...deferred];
			deferred.clear();
			for (const source of pending) runSource(source);
		});
	}

	function runAll(): void {
		assertNotInCommit();
		for (const source of sources) runSource(source);
	}

	function addSource(source: DecorationSource): DecorationSourceHandle {
		if (names.has(source.name)) {
			throw new Error(
				`addSource: a decoration source named '${source.name}' is already registered`
			);
		}
		names.add(source.name);
		sources.push(source);
		results = [...results, []];
		runSource(source);
		// Not `sources.indexOf`: disposing frees the name, so the same source object may be
		// registered again, and this handle must do nothing for that second registration.
		let live = true;
		return {
			invalidate: () => {
				if (!live) return;
				if (isCommitInProgress()) runAfterCommit(source);
				else runSource(source);
			},
			dispose: () => {
				if (!live) return;
				live = false;
				const i = sources.indexOf(source);
				sources.splice(i, 1);
				names.delete(source.name);
				results = results.filter((_, idx) => idx !== i);
			}
		};
	}

	function filterMarks(bucket: IndexedDecoration[]): IndexedDecoration<MarkDecoration>[] {
		return bucket.filter((d): d is IndexedDecoration<MarkDecoration> => d.dec.type === 'mark');
	}

	return {
		addSource,
		get sourceCount() {
			return sources.length;
		},
		notifyEdit() {
			assertNotInCommit();
			editEpoch++;
			runAll();
		},
		marksForPath(path) {
			const bucket = byPath.get(pathKey(path));
			return bucket ? filterMarks(bucket) : EMPTY_MARKS;
		},
		marksForDescendants(path) {
			const bucket = byAncestor.get(pathKey(path));
			return bucket ? filterMarks(bucket) : EMPTY_MARKS;
		},
		islandsForPath(path) {
			const bucket = byPath.get(pathKey(path));
			if (!bucket) return EMPTY_ISLANDS;
			const islands = bucket.filter(
				(d): d is IndexedDecoration<WidgetDecoration | ReplaceDecoration> =>
					d.dec.type === 'widget' || d.dec.type === 'replace'
			);
			return islands.sort((a, b) => islandPosition(a.dec) - islandPosition(b.dec));
		},
		blockDecorationsForPath(path) {
			const bucket = byPath.get(pathKey(path));
			if (!bucket) return EMPTY_BLOCKS;
			return bucket
				.filter((d): d is IndexedDecoration<BlockDecoration> => d.dec.type === 'block')
				.map((d) => d.dec);
		}
	};
}

// A re-run inside a commit would let a source read a half-applied tree.
function assertNotInCommit(): void {
	assertInvariant('decoration-run-in-commit', () =>
		isCommitInProgress()
			? {
					code: 'decoration-run-in-commit',
					message: 'the decorations subsystem re-ran inside the commit sequence'
				}
			: null
	);
}
