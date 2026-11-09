/** One editor's decoration sources, their merged results, and each mounted block's paint, which
 *  the overlays, inline widgets and block classes read: the whole-document input first, then each
 *  source asked one block at a time. A whole-document source never runs inside a commit. */
import { assertInvariant, devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { tick } from 'svelte';
import type { DocumentView, NodeView } from '../core/node-views';
import { groupDecorationsByPath, pathKey, type IndexedDecoration } from './buckets';
import {
	NO_PAINT,
	splitBucket,
	keepEqualParts,
	withDecorations,
	type BlockPaint,
	type BlockSource
} from './block-paint';
import { createMarkHover, type MarkHoverTracker, type MarkIdentity } from './mark-hover';
import type { Decoration, DecorationSource, DecorationSourceHandle, MarkDecoration } from './types';
import { isCommitInProgress } from '../commit-scope';
import { inlineWidgetMiss } from './paint-lands';
import { blockNodeAt, isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { recordDecorationRun } from '../perf/instruments';

const EMPTY_MARKS: IndexedDecoration<MarkDecoration>[] = [];
const NO_SOURCES: readonly BlockSource[] = [];

export interface DecorationEngineDeps {
	getDoc: () => DocumentView;
	onSourceError?: (sourceName: string, error: unknown) => void;
	/** A mark's own handler threw; `path` is the mark's. */
	onMarkError?: (path: number[], error: unknown) => void;
	/** The sources asked one block at a time, in precedence order; a reactive read. */
	blockSources?: () => readonly BlockSource[];
	/** Lands the caret where a click on a mark pressed, once its handler let it. */
	landClick?: (event: MouseEvent) => void;
}

export type DecorationEngine = {
	addSource(source: DecorationSource): DecorationSourceHandle; // dup name throws
	readonly sourceCount: number;
	/** Re-runs every source after bumping the edit counter. `handle.invalidate()` skips the bump,
	 *  so a memoized source can tell a document change from a change in its own state. */
	notifyEdit(): void;
	/** What paints over the mounted block `node` at `path`, for its reactive reads: the same arrays
	 *  come back until that block's paint changes. */
	paintOf(node: NodeView, path: readonly number[]): BlockPaint;
	/** Every call into a mark's `interactive` handlers goes through here, so a throw is reported. */
	runMarkHandler(dec: MarkDecoration, call: () => void): void;
	/** A click on a mark that takes the pointer: its handler runs, then, unless it called
	 *  `preventDefault`, the caret lands where the press was. */
	clickMark(dec: MarkDecoration, event: MouseEvent): void;
	markHover: MarkHoverTracker;
};

export function createDecorationEngine(deps: DecorationEngineDeps): DecorationEngine {
	// Lined up with `results` by index. A handle closes over the source object, not its index,
	// so disposing one never leaves another pointing at the wrong entry.
	const sources: DecorationSource[] = [];
	const names = new Set<string>();
	// Which source each decoration came from, read by the hover's identity.
	const sourceOf = new WeakMap<Decoration, string>();
	const warnedUnrenderableIslands = new Set<string>();
	let results = $state<Decoration[][]>([]);
	// Deliberately not reactive: an `invalidate()` that reads it must not schedule a recompute
	// of the derived buckets.
	let editEpoch = 0;

	const merged = $derived(results.flat());
	// A path's paint is the one it held while equal, so its block's readers stay quiet. Not state:
	// only this derived reads or writes it.
	let heldByPath = new Map<string, BlockPaint>();
	const byPath = $derived.by(() => {
		const next = new Map<string, BlockPaint>();
		for (const [key, bucket] of groupDecorationsByPath(merged)) {
			const parts = splitBucket(bucket.map(({ dec }) => dec));
			const held = heldByPath.get(key);
			next.set(key, held ? keepEqualParts(held, parts) : parts);
		}
		heldByPath = next;
		return next;
	});

	// Held per node, not per path: an insert above hands a path to another block.
	const combined = new WeakMap<
		NodeView,
		{ whole: BlockPaint; parts: readonly (readonly Decoration[])[]; paint: BlockPaint }
	>();

	function paintOf(node: NodeView, path: readonly number[]): BlockPaint {
		const whole = byPath.get(pathKey(path)) ?? NO_PAINT;
		const blockSources = deps.blockSources?.() ?? NO_SOURCES;
		if (blockSources.length === 0) return whole;
		const parts = blockSources.map((source) => source.decorationsOf(node, path));
		const held = combined.get(node);
		if (held?.whole === whole && sameItems(held.parts, parts)) return held.paint;
		parts.forEach((part, i) => {
			if (part !== held?.parts[i]) for (const dec of part) sourceOf.set(dec, blockSources[i].name);
		});
		const paint = parts.every((part) => part.length === 0)
			? whole
			: keepEqualParts(held?.paint ?? NO_PAINT, withDecorations(whole, parts.flat()));
		combined.set(node, { whole, parts, paint });
		return paint;
	}

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
		// Read back through the state, whose objects are the ones the buckets hold.
		for (const dec of results[i]) sourceOf.set(dec, source.name);
	}

	function runMarkHandler(dec: MarkDecoration, call: () => void): void {
		try {
			call();
		} catch (error) {
			deps.onMarkError?.(dec.path, error);
		}
	}

	const markHover = createMarkHover({ identify, runHandler: runMarkHandler });

	// From the block's kept paint, not the latest results: a mark equal to the one it replaced is
	// the object that was painted.
	function identify(dec: MarkDecoration): MarkIdentity | null {
		if (!dec.interactive?.onHover) return null;
		const node = blockNodeAt(deps.getDoc(), dec.path);
		const marks = node ? paintOf(node, dec.path).marks : EMPTY_MARKS;
		const at = marks.findIndex((m) => m.dec === dec);
		if (at < 0) return null;
		const source = sourceNameOf(dec);
		if (source === null) return null;
		const ordinal = marks
			.slice(0, at)
			.filter((m) => sourceNameOf(m.dec) === source && sameHoverRange(m.dec, dec)).length;
		return { source, path: dec.path, start: dec.start, end: dec.end, ordinal };
	}

	function sourceNameOf(dec: Decoration): string | null {
		const name = sourceOf.get(dec);
		if (name === undefined) return null;
		const live = names.has(name) || deps.blockSources?.().some((source) => source.name === name);
		return live ? name : null;
	}

	function warnUnrenderableIslands(sourceName: string, decs: Decoration[]): void {
		if (!devChecksOn) return;
		const doc = deps.getDoc();
		for (const dec of decs) {
			if (dec.type !== 'widget' && dec.type !== 'replace') continue;
			const node = nodeAt(doc, dec.path);
			if (!node || !isBlockNode(node)) continue;
			const miss =
				dec.type === 'widget'
					? inlineWidgetMiss(node, dec.offset)
					: inlineWidgetMiss(node, dec.start, dec.end);
			if (!miss) continue;
			const key = `${sourceName}\0${miss.reason === 'non-prose' ? node.kind : 'range'}`;
			if (warnedUnrenderableIslands.has(key)) continue;
			warnedUnrenderableIslands.add(key);
			const at = dec.type === 'widget' ? `offset ${dec.offset}` : `${dec.start}..${dec.end}`;
			const where =
				miss.reason === 'non-prose'
					? `on a non-prose ${node.kind} block; decorations render only in prose blocks`
					: `at ${at}, but the block's content ends at ${miss.contentEnd}`;
			devWarn('decorations', `source '${sourceName}' places a ${dec.type} decoration ${where}`, {
				path: dec.path
			});
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
		paintOf,
		runMarkHandler,
		clickMark(dec, event) {
			runMarkHandler(dec, () => dec.interactive?.onClick?.(dec, event));
			if (!event.defaultPrevented) deps.landClick?.(event);
		},
		markHover
	};
}

/** A mark with `onHover` over the same block range. */
function sameHoverRange(
	d: Decoration,
	range: { path: readonly number[]; start: number; end: number }
): boolean {
	return (
		d.type === 'mark' &&
		!!d.interactive?.onHover &&
		d.start === range.start &&
		d.end === range.end &&
		pathKey(d.path) === pathKey(range.path)
	);
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((item, i) => item === b[i]);
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
