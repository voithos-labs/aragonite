/**
 * One windowing unit per block list (the editor root and every nested container that turns
 * it on). It wires up the height estimator, this list's own height table and
 * `createBlockWindow`, maps the editor's one scroll container into this list's coordinates by
 * measuring the DOM, and reports this list's box height upward so the spacers above stay
 * correct. See `docs/design/virtual-rendering.md`.
 */
import { tick, untrack } from 'svelte';
import { HeightModel } from '../cursor/height-model';
import type { HeightOracle } from '../cursor/height-oracle';
import type { Scrollport } from '../cursor/scrollport';
import { createBlockWindow, type BlockWindow, type WindowResult } from './block-window.svelte';
import { estimateWidth, effectiveViewportHeight, listTopWithinContent } from './scope-geometry';
import { runMeasureBatch, type MeasureEntry } from './measure-batch';
import type { NodeView } from '../core/node-views';
import type { RevealBlock } from '../cursor/reveal-anchor';
import { recordHeightTableBuild } from '../perf/instruments';

/**
 * The block being scrolled into view, in one list's coordinates. The height table addresses
 * only this list's own children, so a target further down arrives as its top-level ancestor's
 * `index` plus the measured drop to the target, which holds the block the scroll aimed at
 * rather than its container.
 */
export interface RevealAnchorPlacement {
	index: number;
	block: RevealBlock;
	/** Drop from the ancestor's top to the target's top; 0 when the target is the ancestor. */
	innerOffset: number;
	/** The target's own height, for `'center'`; null when it can't be measured. */
	height: number | null;
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
	getPort: () => Scrollport | null;
	/** The focused block's full path, so each level knows which block to hold in place. */
	getFocusPath: () => number[] | null;
	/** Where the block being scrolled into view sits in this list's coordinates, else null.
	 *  While set, `correctAnchor` holds that position instead of the block at the top of the
	 *  viewport. Wired on the root list only: nested lists would fight over one `scrollTop`. */
	getRevealAnchorTarget?: () => RevealAnchorPlacement | null;
	/** Counter bumped on an editor width change, after the height estimator's measured cache
	 *  is cleared. Rebuilds the height table at the new width and re-measures mounted blocks. */
	getWidthVersion: () => number;
	/** Counter bumped when the scroll container's height changes. How far the slice reaches
	 *  comes from a plain DOM height read, which nothing reactive sees; this is that
	 *  dependency. */
	getViewportHeightVersion: () => number;
	/** This list's path (the `parentPath` its children render under). `[]` at top level. */
	getParentPath: () => number[];
	/** This list's own measurable box; re-measured when its contents reflow, to report a fresh
	 *  subtotal upward. Absent at top level. */
	getOwnEl?: () => HTMLElement | null;
	/** Report this list's box height to the parent list's `setChildSubtotal` (absent at top
	 *  level). */
	reportSelfHeight?: (height: number) => void;
	/** False while the browser's own scroll anchoring holds the user's place instead (host mode
	 *  below the windowing threshold): two writers on one scroll position correct it twice. */
	correctsScroll: () => boolean;
	/** While true this list mounts only its title row, a fixed `[0, 1)` with no spacers. The
	 *  window math is skipped, not fed a smaller range: collapsing removes height, and a
	 *  clamped slice through `computeWindow` would emit the body as one giant spacer. */
	isCollapsed?: () => boolean;
	overscan: number;
	pinExtensionCap: number;
	activateAbovePx: number;
	deactivateBelowPx: number;
}

export interface ListWindowing {
	readonly window: WindowResult;
	/** A leaf measured directly: the height estimator by id, the height table by index. It
	 *  writes no `scrollTop`. */
	recordMeasuredChild(index: number, id: string, height: number): void;
	/** A subtotal a child container reported up: the height estimator and the height table,
	 *  addressed by index. No scroll correction. */
	setChildSubtotal(index: number, total: number): void;
	/** Sign a child up for this list's batched measure pass, read after the flush that
	 *  registered it; returns the function to call when the child unmounts. The list reads every
	 *  pending child before applying any write, so a fast scroll that mounts many costs one
	 *  reflow. */
	registerChild(id: string, child: MeasureEntry): () => void;
	/** Re-measure one registered child immediately, after an edit changed its height. */
	measureChildNow(id: string): void;
	/** The ResizeObserver path: compare `observedHeight` in O(1) against the height this list
	 *  last applied and re-measure only on a real change after mount, so the resize a mount
	 *  fires for nothing costs no DOM read during a fast scroll. */
	measureChildOnResize(id: string, observedHeight: number): void;
	/**
	 * True when the scroll position is already where the block being scrolled into view
	 * belongs. Asked by any writer that would otherwise add a relative delta to the same
	 * `scrollTop`: this position comes from live geometry, so a delta on top counts twice. A
	 * question, never a write: moving here would drag the user to the top of that block on a
	 * resize they only wanted compensated. Root list only; a nested list answers false.
	 */
	revealHoldsScroll(): boolean;
	/** Scroll this list so child `index` is inside the mounted range; resolves after a tick. */
	revealChild(index: number): Promise<void>;
	/** True when `index` is in the currently mounted range (always true while windowing is
	 *  off; only the title row while collapsed). Read after `revealChild` to confirm the scroll
	 *  arrived, before waiting on a mount that can otherwise never come (VR-5). */
	isInWindow(index: number): boolean;
	dispose(): void;
}

/**
 * Whether a resize is worth re-measuring (pure, unit-tested). Decided on the height
 * differing from the recorded one, never on which callback delivered it: a remount from cache
 * can report the grown size in the very first callback, so a rule about callback order would
 * drop it. `recorded === undefined` means this list has applied no height for the block yet,
 * so leave it to the batched pass rather than racing a read into a fast scroll's layout.
 */
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

// This list's top within the scroll container's content: the offset that converts the
// container's `scrollTop` into this list's own range, correct at every depth because the
// spacers preserve the geometry above the list. Computed in one place, since two callers
// disagreeing would be a coordinate bug. The arithmetic itself is pure (`scope-geometry`).
function listTopInPort(port: Scrollport, listEl: HTMLElement): number {
	return listTopWithinContent(
		listEl.getBoundingClientRect().top,
		port.viewportTop(),
		port.scrollTop()
	);
}

/** The height table for one child list, with the ids it was built from lined up by index. */
interface HeightTable {
	model: HeightModel;
	/** A snapshot, not read live: the scroll correction needs the old ordering to find the held
	 *  block by id after the children change. */
	ids: string[];
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
	/**
	 * A block that survives a rebuild keeps its measured height (`carried`); re-estimating would
	 * swap a document of measurements for guesses and scroll the user by the difference (VR-15).
	 * Null after a width or font-size change, when the old heights are wrong anyway.
	 */
	function buildTable(carried: Map<string, number> | null, widthVersion: number): HeightTable {
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
	let latestTable: HeightTable | null = null;
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

	// One batched pass owned by this list rather than an effect per child, which would
	// interleave a layout read with the previous child's write and force one reflow per mounted
	// block on a fast scroll. `pending` holds ids awaiting a first measure; registering drains it.
	const registry = new Map<string, RegisteredChild>();
	const pending = new Set<string>();

	/**
	 * The `scrollTop` that puts the block being scrolled into view where it was asked to go,
	 * or null when no such scroll is in progress. The one definition of where that block
	 * belongs, shared by the writer that moves there and the check that asks whether we are
	 * there. The ancestor's offset comes from the height table, never `getBoundingClientRect`:
	 * writing to the table only marks `$state` dirty, so a DOM read here would see stale layout.
	 */
	function revealTargetScrollTop(): number | null {
		const port = deps.getPort();
		const listEl = deps.getListEl();
		const reveal = deps.getRevealAnchorTarget?.() ?? null;
		if (reveal == null || reveal.index >= table.model.size || !port || !listEl) return null;

		const targetTop =
			listTopInPort(port, listEl) + table.model.offsetOf(reveal.index) + reveal.innerOffset;
		// Centre on the scroll container's own height, not `scopeViewportHeight()`: the
		// container's is stable while the content shrinks, whereas the per-list intersection reads
		// `listEl` geometry mid-change and would centre on a briefly tiny viewport.
		const targetHeight = reveal.height ?? table.model.heightOf(reveal.index);
		return reveal.block === 'center'
			? targetTop - Math.max(0, (port.viewportHeight() - targetHeight) / 2)
			: targetTop;
	}

	function placeRevealTarget(): boolean {
		const targetScrollTop = revealTargetScrollTop();
		const port = deps.getPort();
		if (targetScrollTop === null || !port) return false;
		port.setScrollTop(targetScrollTop);
		// A scripted `scrollTop` write fires no `scroll` event, so the window's derived scroll
		// position would stay stale and leave the target unmounted at the very position we just
		// scrolled it to.
		win.syncScrollTop();
		return true;
	}

	/**
	 * Runs the change and writes no scroll while the browser's own anchoring holds the user's
	 * place (host mode below the windowing threshold). It wins even over a scroll into view,
	 * which would otherwise re-assert an absolute position the browser is already holding: two
	 * writers on one scroll position correct it twice.
	 */
	function skipWhileHostAnchors(mutate: () => void): boolean {
		if (deps.correctsScroll()) return false;
		mutate();
		return true;
	}

	/**
	 * A scroll into view wins over either rule for holding a block still: the target's absolute
	 * position is re-asserted after the change, overriding the browser's own clamping, which
	 * drags `scrollTop` off the target while undecoded images outside the viewport measure about
	 * zero. Adding a delta cannot keep up with that clamping. Returns true when it ran the
	 * change and owns the scroll position; shared because both corrections need it.
	 */
	function reassertRevealAnchor(mutate: () => void): boolean {
		const reveal = deps.getRevealAnchorTarget?.() ?? null;
		if (reveal == null || reveal.index >= table.model.size || !deps.getPort()) return false;
		mutate();
		placeRevealTarget();
		return true;
	}

	/**
	 * Which block this correction holds still: the one at the top of the viewport by default,
	 * the focused one when it sits at or below that. Clicking a construct that shows its source
	 * (a math block, a paragraph with inline math) resizes that block and hides the source of
	 * whichever showed it before; holding the top of the viewport, both slide the clicked block
	 * out from under the pointer. Holding the focused block keeps its start where it is, so
	 * only the content after it reflows.
	 */
	function anchorIndexFor(topIndex: number): number {
		const pinned = pinnedIndex();
		if (pinned === null || pinned < topIndex || pinned >= table.model.size) return topIndex;
		return pinned;
	}

	// Hold one block's screen position across a height change that would otherwise slide the
	// visible content (VR-2); the browser's `overflow-anchor` is off wherever this runs, so
	// nothing else holds it. The delta comes from the height table, not `getBoundingClientRect`:
	// writing to the table only marks `$state` dirty, so a DOM read here would see the layout
	// from before the flush and a delta of about zero.
	function correctAnchor(mutate: () => void): void {
		if (skipWhileHostAnchors(mutate)) return;
		if (reassertRevealAnchor(mutate)) return;
		const port = deps.getPort();
		const anchorIndex = anchorIndexFor(table.model.indexAtOffset(localScrollTop()));
		const before = table.model.offsetOf(anchorIndex);
		mutate();
		const delta = table.model.offsetOf(anchorIndex) - before;
		if (delta !== 0 && port) port.scrollBy(delta);
	}

	// The version of `correctAnchor` for a new table. A change in the child count shifts every
	// index after it, so the index-based version would measure a different block at index N and
	// correct by about one block's height too much (the VR-2 jump on an edit above the viewport).
	// Find the block by its stable id instead, against the old table's ordering; a held block
	// that was deleted has nothing left to hold, so skip.
	function correctAnchorByStableId(
		before: HeightTable,
		after: HeightTable,
		mutate: () => void
	): void {
		if (skipWhileHostAnchors(mutate)) return;
		if (reassertRevealAnchor(mutate)) return;
		const port = deps.getPort();
		const lst = localScrollTop();
		const anchorIndex = before.model.indexAtOffset(lst);
		const offsetBefore = before.model.offsetOf(anchorIndex);
		const anchorId = before.ids[anchorIndex];
		mutate();
		// At `lst === 0` the block at the top of the viewport belongs to a list above this one,
		// so this list holds nothing: a nonzero delta could only come from the block moving within
		// this list, and following it would shift the shared `scrollTop` for no reason. The
		// index-based version needs no such check: `offsetOf` of the same index is 0 here anyway.
		if (lst === 0) return;
		const newIndex = anchorId !== undefined ? after.ids.indexOf(anchorId) : -1;
		if (newIndex === -1) return;
		const delta = after.model.offsetOf(newIndex) - offsetBefore;
		if (delta !== 0 && port) port.scrollBy(delta);
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
			// One correction across one change of table: a delta taken between the new estimates and
			// the re-measure compares measured-before against estimated-after, and lands a block off
			// wherever the wrong table names a different top child (#188). Width only: re-measuring
			// on a structural edit costs a reflow per split.
			correctAnchorByStableId(before, next, () => {
				heightVersion++;
				if (widthChanged) remeasureMounted();
			});
		});
	});

	// Convert the scroll container's `scrollTop` into this list's own range.
	function localScrollTop(): number {
		const port = deps.getPort();
		const listEl = deps.getListEl();
		if (!port || !listEl) return 0;
		return Math.max(0, port.scrollTop() - listTopInPort(port, listEl));
	}

	// Each list windows against its own slice of the viewport: against the full container
	// height, N stacked lists would each mount a viewport's worth of blocks. Falls back to the
	// full height when the list is unmounted. Read only by the window `$derived`, which is why
	// the height counter is read here and not in `revealTargetScrollTop`.
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

	// The block this list holds: the focus path's index at this list's depth, and only when
	// the focus path runs through this list.
	function pinnedIndex(): number | null {
		const fp = deps.getFocusPath();
		const pp = deps.getParentPath();
		if (!fp || fp.length <= pp.length) return null;
		for (let i = 0; i < pp.length; i++) if (fp[i] !== pp[i]) return null;
		return fp[pp.length];
	}

	const win: BlockWindow = createBlockWindow({
		getModel: () => {
			void heightVersion;
			return table.model;
		},
		getPort: deps.getPort,
		getLocalScrollTop: localScrollTop,
		getViewportHeight: scopeViewportHeight,
		getPinnedIndex: pinnedIndex,
		overscan: deps.overscan,
		pinExtensionCap: deps.pinExtensionCap,
		activateAbovePx: deps.activateAbovePx,
		deactivateBelowPx: deps.deactivateBelowPx
	});

	// The collapsed window, substituted in what this factory returns. While collapsed it does
	// not read `win.result`, so the skipped math, and the hysteresis it tracks, never sees the
	// clamp.
	const effectiveWindow = $derived.by(() => (deps.isCollapsed?.() ? collapsedWindow : win.result));

	// Children measuring in resize the spacers, so the box height the parent measured when this
	// container mounted goes stale. The box height, not the table's total, so it matches what this
	// container's own BlockHost measured; otherwise two writers fight over one entry. Checked
	// against the box actually moving: without that, the rect read and the upward write chain
	// through the lists inside the observer's own frame and raise its loop warning (#189).
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
		// The batch writes entries above the viewport too, so the correction keeps the block at
		// the top of the viewport fixed.
		correctAnchor(drainMeasurements);
	}

	// Read the height before `correctAnchor` so no DOM read follows the write to the height
	// table. The write stops once the height stops changing (`recordMeasuredChild` then does
	// nothing), so a redundant call cannot spin the reactive graph.
	function measureOne(id: string): void {
		const child = registry.get(id);
		if (!child) return;
		const h = child.readHeight();
		if (h > 0) correctAnchor(() => child.applyHeight(h));
	}

	return {
		get window() {
			return effectiveWindow;
		},
		// No scroll correction here; the page stays steady on the quality of the estimates plus
		// the spacers.
		recordMeasuredChild(index, id, height) {
			deps.oracle.recordMeasured(id, height);
			if (index < table.model.size && table.model.heightOf(index) !== height) {
				table.model.setHeight(index, height);
				heightVersion++;
			}
		},
		// List items aren't BlockHosts and nothing else records their heights, so without this
		// write a parent rebuild would fall back to estimates for them and the viewport jumps.
		// Harmless to repeat for hosted children. The id comes from the table's own snapshot, so
		// it names the child at the index the table is written at.
		setChildSubtotal(index, total) {
			const id = table.ids[index];
			if (id !== undefined) deps.oracle.recordMeasured(id, total);
			if (index >= table.model.size || table.model.heightOf(index) === total) return;
			const write = () => {
				table.model.setHeight(index, total);
				heightVersion++;
			};
			// No correction unless a scroll into view is in progress; that is the only exception, so
			// every other write still cascades nothing. Without it, growth inside the target's own
			// container pushes a target already placed down by its full height (#32).
			if (!skipWhileHostAnchors(write) && !reassertRevealAnchor(write)) write();
		},
		// Read after the flush that mounted the child, not inside it: content can land later in
		// that flush (an inline widget's root flushes after this one), and reading an empty block
		// is a scroll correction the observer undoes a frame later. Still before paint.
		registerChild(id, child) {
			const entry: RegisteredChild = {
				readHeight: child.readHeight,
				applyHeight: (h) => {
					entry.applied = h;
					child.applyHeight(h);
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
		// The ResizeObserver path, for growth that arrives later. The check reads what this list
		// last applied (O(1), no DOM), so the resize a mount fires for nothing on every block a
		// fast scroll mounts returns without a rect read on the spacer-dirtied layout (VR-4).
		measureChildOnResize(id, observedHeight) {
			if (shouldRemeasureOnResize(registry.get(id)?.applied, observedHeight)) measureOne(id);
		},
		revealHoldsScroll() {
			const targetScrollTop = revealTargetScrollTop();
			const port = deps.getPort();
			// Sub-pixel tolerance: the refinement loop lands a fraction of a device pixel off the
			// position the height table gives, and an exact compare would let the delta back in.
			return (
				targetScrollTop !== null && !!port && Math.abs(port.scrollTop() - targetScrollTop) <= 1
			);
		},
		async revealChild(index) {
			// A body child of a collapsed list can never mount, so give up rather than wait.
			if (index >= 1 && deps.isCollapsed?.()) return;
			const port = deps.getPort();
			const listEl = deps.getListEl();
			if (!port || !listEl) return;
			port.setScrollTop(listTopInPort(port, listEl) + table.model.offsetOf(index));
			win.syncScrollTop();
			await tick();
		},
		isInWindow(index) {
			// The effective window, always: while windowing is off the unclamped window answers true
			// for every index, so scrolling into a collapsed body would wait on a mount that can
			// never come (VR-5).
			const { start, end } = effectiveWindow;
			return index >= start && index < end;
		},
		dispose() {
			win.dispose();
		}
	};
}
