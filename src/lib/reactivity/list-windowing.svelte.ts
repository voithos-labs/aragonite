/**
 * One windowing unit per block list, the editor root or a nested container: its height table
 * and mounted range, read against the editor's one scroll container in this list's coordinates.
 * Reports its box height upward so the spacers above stay correct.
 * See `docs/design/virtual-rendering.md` § Nesting.
 */
import { tick, untrack } from 'svelte';
import { HeightModel } from '../cursor/height-model';
import type { HeightOracle } from '../cursor/height-oracle';
import type { ScrollportReader } from '../cursor/scrollport';
import type { TargetTop } from '../cursor/scroll-owner';
import { createBlockWindow, type BlockWindow, type WindowResult } from './block-window.svelte';
import { estimateWidth, effectiveViewportHeight, listTopWithinContent } from './scope-geometry';
import { runMeasureBatch, type MeasureEntry } from './measure-batch';
import {
	focusedIndexIn,
	heldBlock,
	holdAcross,
	type HeightTable,
	type HeldDelta
} from './hold-across';
import type { NodeView } from '../core/node-views';
import { recordHeightTableBuild } from '../perf/instruments';

/** The scroll writes a list makes, through the editor's scroll owner, which decides who owns the
 *  position first. */
export interface ListScrollWrites {
	/** `held` runs the change and returns how far the held block moved, which only `holdAcross`
	 *  can answer, so no correction picks its block any other way. */
	compensate(mutate: () => void, held: (mutate: () => void) => HeldDelta): void;
	scrollToMount(contentTop: number): void;
}

export interface ListWindowingDeps {
	oracle: HeightOracle;
	getChildren: () => readonly NodeView[];
	getChildIds: () => string[];
	/** This list's own element; its top within the scroll content converts the scroll
	 *  container's `scrollTop` into this list's coordinates. */
	getListEl: () => HTMLElement | null;
	/** The one scroll container every list in this editor windows against: the editor root
	 *  under `scrollMode="self"`, the host's scroller or the page viewport under `"host"`. */
	getPort: () => ScrollportReader | null;
	scroll: ListScrollWrites;
	/** The focused block's full path, so each level knows which block to hold in place. */
	getFocusPath: () => number[] | null;
	/** Counter bumped on an editor width change, after the height estimator's measured cache
	 *  is cleared. Rebuilds the height table at the new width and re-measures mounted blocks. */
	getWidthVersion: () => number;
	/** Bumped when the scroll container's height changes, since the viewport height comes from
	 *  a plain DOM read that nothing reactive sees. */
	getViewportHeightVersion: () => number;
	/** This list's path (the `parentPath` its children render under). `[]` at top level. */
	getParentPath: () => number[];
	/** This list's own measurable box; re-measured when its contents reflow, to report a fresh
	 *  subtotal upward. Absent at top level. */
	getOwnEl?: () => HTMLElement | null;
	/** Report this list's box height to the parent list's `setChildSubtotal` (absent at top
	 *  level). */
	reportSelfHeight?: (height: number) => void;
	/** While true the list mounts only its title row and skips the window math: collapsing
	 *  removes height, and a clamped slice would emit the body as one giant spacer. */
	isCollapsed?: () => boolean;
	overscan: number;
	pinExtensionCap: number;
	activateAbovePx: number;
	deactivateBelowPx: number;
}

/** A child of this list, measured under its own id at its slot. */
export interface MeasuredChild {
	index: number;
	readHeight: () => number;
}

export interface ListWindowing {
	readonly window: WindowResult;
	/** A subtotal a child container reported up: the height estimator and the height table,
	 *  addressed by index. No scroll correction. */
	setChildSubtotal(index: number, total: number): void;
	/** Queues a child for the batched measure pass after the flush that registered it, so a fast
	 *  scroll that mounts many costs one reflow. Returns the unregister function. */
	registerChild(id: string, child: MeasuredChild): () => void;
	/** Re-measure one registered child immediately, after an edit changed its height. */
	measureChildNow(id: string): void;
	/** Compares `observedHeight` against the height last applied, with no DOM read, so the
	 *  no-op resize every mount fires costs nothing during a fast scroll. */
	measureChildOnResize(id: string, observedHeight: number): void;
	/** Where child `index`'s top sits in the scroll container's content, by the height table,
	 *  and its height; null past the end or before the list mounts. */
	targetTopOf(index: number): TargetTop | null;
	/** A scripted `scrollTop` write fires no `scroll` event in time, so the window re-reads it. */
	syncScrollTop(): void;
	/** Scroll this list so child `index` is inside the mounted range; resolves after a tick. */
	revealChild(index: number): Promise<void>;
	/** Whether `index` is in the mounted range; read after `revealChild` so a wait for the mount
	 *  gives up instead of hanging when the scroll didn't bring it in (VR-5). */
	isInWindow(index: number): boolean;
	dispose(): void;
}

/** Whether a resize is worth re-measuring: only when the height differs from the one this list
 *  applied. With none applied yet, the batched pass owns the first measure. */
export function shouldRemeasureOnResize(recorded: number | undefined, observed: number): boolean {
	if (observed <= 0 || recorded === undefined) return false;
	return Math.abs(recorded - observed) >= 1;
}

interface RegisteredChild extends MeasureEntry {
	/** What this list last applied for the child: what the resize check compares against,
	 *  which clearing the height estimator's cache (a mode switch) must not blank. */
	applied: number | undefined;
}

// One shared result backs every collapsed list, frozen so a consumer that mutates its
// window cannot quietly corrupt other lists through the shared object.
const collapsedWindow: WindowResult = Object.freeze({
	active: true,
	start: 0,
	end: 1,
	topSpacerPx: 0,
	bottomSpacerPx: 0
});

function listTopInPort(port: ScrollportReader, listEl: HTMLElement): number {
	return listTopWithinContent(
		listEl.getBoundingClientRect().top,
		port.viewportTop(),
		port.scrollTop()
	);
}

/** This list's height table and the width it was built at. */
interface BuiltTable extends HeightTable {
	widthVersion: number;
	/** False when the list had no element yet, so every estimate used the scroll container's width. */
	atListWidth: boolean;
}

/** The heights a table holds, keyed by id, for the next build to keep. */
function heightsById(table: HeightTable): Map<string, number> {
	const carried = new Map<string, number>();
	const known = Math.min(table.ids.length, table.model.size);
	for (let i = 0; i < known; i++) carried.set(table.ids[i], table.model.heightOf(i));
	return carried;
}

export function createListWindowing(deps: ListWindowingDeps): ListWindowing {
	/** A block that survives a rebuild keeps its measured height (`carried`), or the user scrolls by
	 *  the estimate error (VR-15). Null once a width or font-size change has made them wrong. */
	function buildTable(carried: Map<string, number> | null, widthVersion: number): BuiltTable {
		const listEl = deps.getListEl();
		const width = estimateWidth(listEl, deps.getPort()?.contentWidth() ?? 0);
		recordHeightTableBuild(deps.getParentPath(), width);
		const children = deps.getChildren();
		// Indexed, and off the snapshot: `map` pays a `has` trap beside every `get`, once per child.
		const ids = deps.getChildIds().slice();
		const count = children.length;
		const heights = new Array<number>(count);
		for (let i = 0; i < count; i++) {
			const id = ids[i];
			heights[i] =
				deps.oracle.measured(id) ?? carried?.get(id) ?? deps.oracle.estimate(children[i], width);
		}
		return { model: new HeightModel(heights), ids, widthVersion, atListWidth: listEl !== null };
	}

	// A derived, so new children window from their own table (VR-14); it tracks ids, not estimates,
	// and the list element, so the first table, built before the element exists, is redone (VR-3).
	let latestTable: BuiltTable | null = null;
	const table = $derived.by(() => {
		const ids = deps.getChildIds();
		for (let i = 0; i < ids.length; i++) void ids[i];
		void deps.getPort();
		void deps.getListEl();
		const widthVersion = deps.getWidthVersion();
		return untrack(() => {
			const previous = latestTable;
			const keepsHeights =
				previous !== null && previous.widthVersion === widthVersion && previous.atListWidth;
			latestTable = buildTable(keepsHeights ? heightsById(previous) : null, widthVersion);
			return latestTable;
		});
	});
	let heightVersion = $state(0);

	// One batched pass per list, not an effect per child, which would interleave each layout read
	// with the previous write and reflow once per mounted block. `pending` awaits a first measure.
	const registry = new Map<string, RegisteredChild>();
	const pending = new Set<string>();

	// Every height change keeps one block still (VR-2), since `overflow-anchor` is off. The focus
	// path is read live, so in a rebuild it counts in `after`.
	function correctAcross(before: HeightTable, after: () => HeightTable, mutate: () => void): void {
		deps.scroll.compensate(mutate, (run) =>
			holdAcross(before, after, heldBlock(before, after(), localScrollTop(), focusedIndex()), run)
		);
	}

	// The scroll correction for a new table waits for the flush, when the list's geometry is
	// readable; the table itself is already in place.
	let correctedTable = untrack(() => table);
	$effect(() => {
		const next = table;
		untrack(() => {
			if (next === correctedTable) return;
			const before = correctedTable;
			const widthChanged = next.widthVersion !== before.widthVersion;
			correctedTable = next;
			// The re-measure runs inside the same correction, so the delta compares measured heights
			// on both sides. Width changes only: re-measuring on a structural edit costs a reflow.
			correctAcross(
				before,
				() => next,
				() => {
					heightVersion++;
					if (widthChanged) remeasureMounted();
				}
			);
		});
	});

	function localScrollTop(): number {
		const port = deps.getPort();
		const listEl = deps.getListEl();
		if (!port || !listEl) return 0;
		return Math.max(0, port.scrollTop() - listTopInPort(port, listEl));
	}

	// Each list windows against its own slice of the viewport, or N stacked lists would each
	// mount a viewport's worth of blocks. The full height stands in while the list is unmounted.
	function scopeViewportHeight(): number {
		void deps.getViewportHeightVersion();
		const port = deps.getPort();
		const listEl = deps.getListEl();
		if (!port) return 0;
		if (!listEl) return port.viewportHeight();
		const listRect = listEl.getBoundingClientRect();
		return effectiveViewportHeight(
			port.viewportTop(),
			port.viewportHeight(),
			listRect.top,
			listRect.height
		);
	}

	function focusedIndex(): number | null {
		return focusedIndexIn(deps.getFocusPath(), deps.getParentPath());
	}

	const win: BlockWindow = createBlockWindow({
		getModel: () => {
			void heightVersion;
			return table.model;
		},
		getPort: deps.getPort,
		getLocalScrollTop: localScrollTop,
		getViewportHeight: scopeViewportHeight,
		getPinnedIndex: focusedIndex,
		overscan: deps.overscan,
		pinExtensionCap: deps.pinExtensionCap,
		activateAbovePx: deps.activateAbovePx,
		deactivateBelowPx: deps.deactivateBelowPx
	});

	// While collapsed `win.result` goes unread, so the window math and its hysteresis never see
	// the clamp.
	const effectiveWindow = $derived.by(() => (deps.isCollapsed?.() ? collapsedWindow : win.result));

	// The box height, not the table total, so it agrees with the parent's measure of the same box;
	// an unchanged box reports nothing, or the upward writes chain inside one resize frame.
	let reportedSelfHeight = 0;
	$effect(() => {
		void heightVersion;
		const el = deps.getOwnEl?.();
		const report = deps.reportSelfHeight;
		if (!el || !report) return;
		// After the flush, like the batch: on this effect's first run the children aren't rendered.
		let live = true;
		void tick().then(() => {
			if (!live) return;
			const h = el.getBoundingClientRect().height;
			if (h > 0 && Math.abs(h - reportedSelfHeight) >= 1) {
				reportedSelfHeight = h;
				report(h);
			}
		});
		return () => {
			live = false;
		};
	});

	// The batch with no scroll correction: the caller owns that, because nesting a second
	// correction inside an outer `mutate` counts the delta twice.
	function drainMeasurements(): void {
		if (pending.size === 0) return;
		const entries: MeasureEntry[] = [];
		for (const id of pending) {
			const child = registry.get(id);
			if (child) entries.push(child);
		}
		pending.clear();
		runMeasureBatch(entries);
	}

	// A width rebuild re-estimates every entry at the new width, but mounted blocks have real
	// heights and their measure effects depend on `node.raw`, not width.
	function remeasureMounted(): void {
		for (const id of registry.keys()) pending.add(id);
		drainMeasurements();
	}

	function flushMeasurements(): void {
		if (pending.size === 0) return;
		// The batch writes entries above the viewport too, so the whole batch runs in one correction.
		correctAcross(table, () => table, drainMeasurements);
	}

	// The one write of a child's height into this table, always inside a correction. A slot that
	// now holds another block keeps its height; the next build reads this id's measurement.
	function applyMeasured(index: number, id: string, height: number): void {
		deps.oracle.recordMeasured(id, height);
		if (table.ids[index] !== id || table.model.heightOf(index) === height) return;
		table.model.setHeight(index, height);
		heightVersion++;
	}

	// Read before the correction so no DOM read follows the height-table write; a repeated call
	// writes nothing once the height is stable, so it cannot spin the reactive graph.
	function measureOne(id: string): void {
		const child = registry.get(id);
		if (!child) return;
		const h = child.readHeight();
		if (h > 0)
			correctAcross(
				table,
				() => table,
				() => child.applyHeight(h)
			);
	}

	return {
		get window() {
			return effectiveWindow;
		},
		// List items aren't BlockHosts and nothing else records their heights, so without this
		// write a parent rebuild would fall back to estimates for them and the viewport jumps.
		setChildSubtotal(index, total) {
			const id = table.ids[index];
			if (id !== undefined) deps.oracle.recordMeasured(id, total);
			if (index >= table.model.size || table.model.heightOf(index) === total) return;
			const write = () => {
				table.model.setHeight(index, total);
				heightVersion++;
			};
			// Holds nothing, a stopgap until each list measures its child containers' boxes itself and
			// this upward report goes; a scroll into view in progress still keeps its target placed.
			deps.scroll.compensate(write, (run) => holdAcross(table, () => table, null, run));
		},
		// Read after the flush that mounted the child, not inside it: content can land later in
		// that flush (an inline widget's root), and measuring an empty block costs a correction.
		registerChild(id, child) {
			const entry: RegisteredChild = {
				readHeight: child.readHeight,
				applyHeight: (h) => {
					entry.applied = h;
					applyMeasured(child.index, id, h);
				},
				applied: undefined
			};
			registry.set(id, entry);
			pending.add(id);
			void tick().then(flushMeasurements);
			return () => {
				registry.delete(id);
				pending.delete(id);
			};
		},
		// No check first: the raw changed, so the height almost certainly did too.
		measureChildNow(id) {
			measureOne(id);
		},
		// For growth that arrives later. The check reads the last applied height, not the DOM, so
		// the no-op resize of each freshly mounted block skips a rect read (VR-4).
		measureChildOnResize(id, observedHeight) {
			if (shouldRemeasureOnResize(registry.get(id)?.applied, observedHeight)) measureOne(id);
		},
		targetTopOf(index) {
			const port = deps.getPort();
			const listEl = deps.getListEl();
			if (index >= table.model.size || !port || !listEl) return null;
			return {
				top: listTopInPort(port, listEl) + table.model.offsetOf(index),
				height: table.model.heightOf(index)
			};
		},
		syncScrollTop() {
			win.syncScrollTop();
		},
		async revealChild(index) {
			// A body child of a collapsed list can never mount, so give up rather than wait.
			if (index >= 1 && deps.isCollapsed?.()) return;
			const port = deps.getPort();
			const listEl = deps.getListEl();
			if (!port || !listEl) return;
			deps.scroll.scrollToMount(listTopInPort(port, listEl) + table.model.offsetOf(index));
			win.syncScrollTop();
			await tick();
		},
		isInWindow(index) {
			// The effective window: with windowing off, `win.result` covers every index, so a scroll
			// into a collapsed body would wait on a mount that never comes (VR-5).
			const { start, end } = effectiveWindow;
			return index >= start && index < end;
		},
		dispose() {
			win.dispose();
		}
	};
}
