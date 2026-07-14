import type { CstNode, Document } from '../core/nodes';
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
import { assertInvariant } from '../invariants/assert';
import { isCommitInProgress } from '../invariants/commit-scope';
import { isProseKind } from '../core/inline';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import { devWarn } from '../dev-warn';

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
	// DEV: source+kind combinations already flagged for targeting an island at a
	// block that never renders islands — warn once each, never per run.
	const warnedUnrenderableIslands = new Set<string>();
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
		warnUnrenderableIslands(slot.source.name, next);
		// Idle-source guard: an empty→empty re-run must not reassign `results`, or every
		// keystroke would republish the derived buckets for sources that never emit.
		if (results[i].length === 0 && next.length === 0) return;
		const copy = results.slice();
		copy[i] = next;
		results = copy;
	}

	// Only the prose text render branch applies islands, so a widget/replace
	// silently no-ops on two block classes: non-prose kinds (code, thematic
	// break — no inline pass at all) and table cells, whose surface runs its own
	// inline pass but applies no island decorations (docs/issues.md). Flag both
	// at the source seam rather than leaving the author to wonder why nothing
	// rendered.
	function islandSkipReason(kind: CstNode['kind']): string | null {
		if (kind === 'tableCell') return 'the table-cell surface does not apply islands';
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
			const kindLabel = node.kind === 'tableCell' ? node.kind : `non-prose ${node.kind}`;
			devWarn(
				'decorations',
				`source '${sourceName}' places a ${dec.type} island on a ${kindLabel} block; ${reason}`,
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

// A re-run inside the commit ceremony would let a source read a half-applied tree.
// The edit subscriber defers notifyEdit a tick past the edit event to stay clear.
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
