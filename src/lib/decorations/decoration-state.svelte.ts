import type { CstNode } from '../core/nodes';
import type { DocumentView } from '../core/node-views';
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
import { assertInvariant } from '../invariants/assert';
import { isCommitInProgress } from '../invariants/commit-scope';
import { isProseKind } from '../core/inline';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
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
	/** Bump the edit epoch, then re-run every provide. `handle.invalidate()` re-runs one
	 *  source WITHOUT the bump, which is what lets a memoized source tell "document
	 *  changed" from "my own state changed". */
	notifyEdit(): void;
	marksForPath(path: number[]): IndexedDecoration<MarkDecoration>[];
	marksForDescendants(path: number[]): IndexedDecoration<MarkDecoration>[];
	islandsForPath(path: number[]): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	blockDecorationsForPath(path: number[]): BlockDecoration[];
};

interface SourceSlot {
	source: DecorationSource;
}

export function createDecorationEngine(deps: DecorationEngineDeps): DecorationEngine {
	// Non-reactive registry state, index-aligned with `results`. Handles close over the slot
	// object, not its index, so a dispose mid-list never staleness-shifts a surviving handle.
	const slots: SourceSlot[] = [];
	const names = new Set<string>();
	const warnedUnrenderableIslands = new Set<string>();
	let results = $state<Decoration[][]>([]);
	// Deliberately not reactive: an invalidate() that reads it must not schedule a
	// recompute of the derived buckets.
	let editEpoch = 0;

	const merged = $derived(results.flat());
	const byPath = $derived(groupDecorationsByPath(merged));
	const byAncestor = $derived(groupDecorationsByAncestor(merged));

	function runSlot(slot: SourceSlot): void {
		const i = slots.indexOf(slot);
		if (i < 0) return; // disposed between schedule and run
		recordDecorationRun();
		let next: Decoration[];
		try {
			next = slot.source.provide(deps.getDoc(), { editEpoch });
		} catch (error) {
			deps.onSourceError?.(slot.source.name, error);
			return; // keep the slot's prior decorations — a throw never blanks the view
		}
		warnUnrenderableIslands(slot.source.name, next);
		// An empty→empty re-run must not reassign `results`, or every keystroke would
		// republish the derived buckets for sources that never emit.
		if (results[i].length === 0 && next.length === 0) return;
		const copy = results.slice();
		copy[i] = next;
		results = copy;
	}

	// Non-prose kinds run no inline pass, so they apply no islands. Flag that at the source
	// seam rather than leaving the author to wonder why nothing rendered.
	function islandSkipReason(kind: CstNode['kind']): string | null {
		if (!isProseKind(kind)) return 'islands render only in prose blocks';
		return null;
	}

	function warnUnrenderableIslands(sourceName: string, decs: Decoration[]): void {
		if (!import.meta.env.DEV) return;
		const doc = deps.getDoc();
		for (const dec of decs) {
			if (dec.type !== 'widget' && dec.type !== 'replace') continue;
			const node = nodeAt(doc, dec.path);
			if (!node || !isBlockNode(node)) continue;
			const reason = islandSkipReason(node.kind);
			if (!reason) continue;
			const key = `${sourceName}\0${node.kind}`;
			if (warnedUnrenderableIslands.has(key)) continue;
			warnedUnrenderableIslands.add(key);
			devWarn(
				'decorations',
				`source '${sourceName}' places a ${dec.type} island on a non-prose ${node.kind} block; ${reason}`,
				{ path: dec.path }
			);
		}
	}

	function runAll(): void {
		assertNotInCommit();
		for (const slot of slots) runSlot(slot);
	}

	function addSource(source: DecorationSource): DecorationSourceHandle {
		if (names.has(source.name)) {
			throw new Error(
				`addSource: a decoration source named '${source.name}' is already registered`
			);
		}
		names.add(source.name);
		const slot: SourceSlot = { source };
		slots.push(slot);
		results = [...results, []];
		runSlot(slot);
		return {
			invalidate: () => runSlot(slot),
			dispose: () => {
				const i = slots.indexOf(slot);
				if (i < 0) return; // idempotent
				slots.splice(i, 1);
				names.delete(slot.source.name);
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
			return slots.length;
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

// A re-run inside the commit ceremony would let a source read a half-applied tree.
function assertNotInCommit(): void {
	assertInvariant('decoration-run-in-commit', () =>
		isCommitInProgress()
			? {
					code: 'decoration-run-in-commit',
					message: 'decoration engine re-ran inside the commit ceremony'
				}
			: null
	);
}
