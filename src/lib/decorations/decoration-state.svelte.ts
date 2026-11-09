/** One editor's decoration sources, their merged results, and each mounted block's paint, which
 *  the overlays, inline widgets and block classes read. A source never runs inside a commit. */
import { assertInvariant, devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { tick } from 'svelte';
import type { DocumentView, NodeView } from '../core/node-views';
import { groupDecorationsByPath, pathKey, type IndexedDecoration } from './buckets';
import { NO_PAINT, splitBucket, keepEqualParts, type BlockPaint } from './block-paint';
import { createMarkHover, type MarkHoverTracker, type MarkIdentity } from './mark-hover';
import type {
	Decoration,
	DecorationSource,
	DecorationSourceHandle,
	MarkDecoration,
	ReplaceDecoration,
	WidgetDecoration
} from './types';
import { isCommitInProgress } from '../commit-scope';
import { contentLengthOf, isProseKind } from '../core/inline';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { recordDecorationRun } from '../perf/instruments';

const EMPTY_MARKS: IndexedDecoration<MarkDecoration>[] = [];

export interface DecorationEngineDeps {
	getDoc: () => DocumentView;
	onSourceError?: (sourceName: string, error: unknown) => void;
	/** A mark's own handler threw; `path` is the mark's. */
	onMarkError?: (path: number[], error: unknown) => void;
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

	// From the path's kept paint, not the latest results: a mark equal to the one it replaced is
	// the object that was painted.
	function identify(dec: MarkDecoration): MarkIdentity | null {
		if (!dec.interactive?.onHover) return null;
		const marks = byPath.get(pathKey(dec.path))?.marks ?? EMPTY_MARKS;
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
		return name !== undefined && names.has(name) ? name : null;
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
		if (!devChecksOn) return;
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
		paintOf(_node, path) {
			return byPath.get(pathKey(path)) ?? NO_PAINT;
		},
		runMarkHandler,
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
