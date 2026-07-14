import type { Document } from '../core/nodes';
import {
	groupDecorationsByAncestor,
	groupDecorationsByPath,
	pathKey,
	type IndexedDecoration
} from '../decorations/buckets';
import type {
	BlockDecoration,
	Decoration,
	DecorationSource,
	DecorationSourceHandle,
	MarkDecoration,
	ReplaceDecoration,
	WidgetDecoration
} from '../decorations/types';

const EMPTY_MARKS: IndexedDecoration<MarkDecoration>[] = [];
const EMPTY_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];
const EMPTY_BLOCKS: BlockDecoration[] = [];

export interface DecorationEngineDeps {
	getDoc: () => Document;
	onSourceError?: (sourceName: string, error: unknown) => void;
}

export type DecorationEngine = {
	addSource(source: DecorationSource): DecorationSourceHandle; // dup name throws
	readonly sourceCount: number;
	/** Bump the edit epoch, then re-run every provide (each contained). The edit
	 *  subscriber calls THIS; handle.invalidate() re-runs one source WITHOUT the
	 *  bump — the split that lets a memoized source distinguish "document changed"
	 *  (epoch miss → rescan) from "my own state changed" (epoch hit → cheap remap). */
	notifyEdit(): void;
	runAll(): void;
	marksForPath(path: number[]): IndexedDecoration<MarkDecoration>[];
	marksForDescendants(path: number[]): IndexedDecoration<MarkDecoration>[];
	islandsForPath(path: number[]): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	blockDecorationsForPath(path: number[]): BlockDecoration[];
};

interface SourceSlot {
	source: DecorationSource;
}

export function createDecorationEngine(deps: DecorationEngineDeps): DecorationEngine {
	// slots + names are plain (non-reactive) registry state, index-aligned with
	// `results`. Handles close over the slot object, not its index, so a dispose
	// mid-list never staleness-shifts a surviving handle.
	const slots: SourceSlot[] = [];
	const names = new Set<string>();
	let results = $state<Decoration[][]>([]);
	// Plain counter — bumped only by notifyEdit, never a $derived dependency, so an
	// invalidate() that reads it can't schedule a reactive recompute of the buckets.
	let editEpoch = 0;

	const merged = $derived(results.flat());
	const byPath = $derived(groupDecorationsByPath(merged));
	const byAncestor = $derived(groupDecorationsByAncestor(merged));

	function runSlot(slot: SourceSlot): void {
		const i = slots.indexOf(slot);
		if (i < 0) return; // disposed between schedule and run
		let next: Decoration[];
		try {
			next = slot.source.provide(deps.getDoc(), { editEpoch });
		} catch (error) {
			deps.onSourceError?.(slot.source.name, error);
			return; // keep the slot's prior decorations — a throw never blanks the view
		}
		// Idle-source guard: an empty→empty re-run must not reassign `results`, or every
		// keystroke would republish the derived buckets for sources that never emit.
		if (results[i].length === 0 && next.length === 0) return;
		const copy = results.slice();
		copy[i] = next;
		results = copy;
	}

	function runAll(): void {
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
			editEpoch++;
			runAll();
		},
		runAll,
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

function islandPosition(dec: WidgetDecoration | ReplaceDecoration): number {
	return dec.type === 'widget' ? dec.offset : dec.start;
}
