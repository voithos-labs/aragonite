import { getContext, onDestroy, setContext } from 'svelte';
import {
	EDITOR_DOC_KEY,
	EDITOR_SERVICES_KEY,
	PARENT_SCOPE_SINK_KEY,
	RECORD_BLOCK_HEIGHT_KEY,
	type BlockElLookup,
	type BlockMeasureChannel,
	type EditorDoc,
	type EditorServices,
	type ParentScopeSink
} from '../editor-keys';
import type { NodeView } from '../core/node-views';
import type { Compensate, RootListScroll, TargetResolver } from '../cursor/scroll-owner';
import { createListWindowing, type ListWindowing } from './list-windowing.svelte';

export interface ContainerWindowingOpts {
	/** This container's index in the list above it, for the subtotal it reports upward. A
	 *  getter, so a reorder reports under the current index. */
	getIndex: () => number;
	/** This list's path. */
	getParentPath: () => number[];
	getChildren: () => readonly NodeView[];
	getChildIds: () => string[];
	/** The element that scrolls with this list's children. Never the viewport. */
	getListEl: () => HTMLElement | null;
	/** The element the parent measures for this list's height. Omit at the root. */
	getOwnEl?: () => HTMLElement | null;
	/** True when this list's direct children are `BlockHost`s, which record their own heights
	 *  through the leaf height channel; false for a list that renders them with `{#each}`. */
	provideLeafChannel: boolean;
	/** True while collapsed; see `ListWindowingDeps.isCollapsed`. */
	isCollapsed?: () => boolean;
}

/**
 * A held block in the root list's terms. The height table addresses only the root's own
 * children, so a deeper target is its top-level ancestor's `index` plus the measured drop to the
 * target, which holds the block the scroll aimed at rather than its container.
 */
export interface RootPlacement {
	index: number;
	/** Drop from the ancestor's top to the target's top; 0 when the target is the ancestor. */
	innerOffset: number;
	/** The target's own height, for `'center'`; null when it can't be measured. */
	height: number | null;
}

/** Where `path` sits in the root list: a nested target is measured against its ancestor. */
export function placementOf(path: readonly number[], blockEl: BlockElLookup): RootPlacement | null {
	if (path.length === 0) return null;
	const shallow = { index: path[0], innerOffset: 0, height: null };
	if (path.length === 1) return shallow;
	const ancestorEl = blockEl([shallow.index]);
	const targetEl = blockEl([...path]);
	// An unmounted ancestor falls back to its own top; a mounted one with no target means the
	// user scrolled past the target inside the container, so decline rather than jump.
	if (!ancestorEl) return shallow;
	if (!targetEl) return null;
	const targetRect = targetEl.getBoundingClientRect();
	return {
		index: shallow.index,
		innerOffset: targetRect.top - ancestorEl.getBoundingClientRect().top,
		height: targetRect.height
	};
}

/** The root list's answer to where a held block sits, from its height table. Offsets come from
 *  the table, since the DOM hasn't laid out the table's latest writes yet. */
export function rootTargetResolver(
	root: Pick<ListWindowing, 'targetTopOf' | 'syncScrollTop'>,
	place: (path: readonly number[]) => RootPlacement | null
): TargetResolver {
	return {
		resolve(path) {
			const placement = place(path);
			const at = placement && root.targetTopOf(placement.index);
			if (!placement || !at) return null;
			return { top: at.top + placement.innerOffset, height: placement.height ?? at.height };
		},
		syncScrollTop: () => root.syncScrollTop()
	};
}

/** One windowing unit per nested container, whether it renders a `BlockList` or its own
 *  `{#each}`. Call synchronously during component init, since it reads and sets context. */
export function useContainerWindowing(opts: ContainerWindowingOpts): ListWindowing {
	const scrollOwner = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.scrollOwner;
	return windowingUnit(opts, (mutate, held) =>
		scrollOwner ? scrollOwner.compensate(mutate, held) : mutate()
	);
}

/** The editor root's windowing, and the one height correction that re-places a held target,
 *  which the header slot shares. Null without the editor's services, as in a harness. */
export function useRootWindowing(
	opts: Pick<ContainerWindowingOpts, 'getChildren' | 'getChildIds' | 'getListEl'>
): { windowing: ListWindowing; scroll: RootListScroll | null } {
	const scrollOwner = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.scrollOwner;
	const { blockElLookup } = getContext<EditorDoc>(EDITOR_DOC_KEY);
	let scroll: RootListScroll | null = null;
	const windowing = windowingUnit(
		{ ...opts, getIndex: () => 0, getParentPath: () => [], provideLeafChannel: true },
		(mutate, held) => (scroll ? scroll.compensate(mutate, held) : mutate())
	);
	if (scrollOwner) {
		scroll = scrollOwner.resolveTargetsWith(
			rootTargetResolver(windowing, (path) => placementOf(path, blockElLookup))
		);
		onDestroy(scroll.uninstall);
	}
	return { windowing, scroll };
}

function windowingUnit(opts: ContainerWindowingOpts, compensate: Compensate): ListWindowing {
	const {
		heightOracle: oracle,
		scrollport: getPort,
		focusedPath: getFocusPath,
		widthVersion: getWidthVersion,
		viewportHeightVersion: getViewportHeightVersion
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);
	const scrollOwner = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.scrollOwner;

	const windowing = createListWindowing({
		oracle,
		getChildren: opts.getChildren,
		getChildIds: opts.getChildIds,
		getListEl: opts.getListEl,
		getOwnEl: opts.getOwnEl,
		getPort: () => getPort?.() ?? null,
		scroll: {
			compensate,
			scrollToMount: (contentTop) => scrollOwner?.scrollToMount(contentTop)
		},
		getFocusPath: () => getFocusPath?.() ?? null,
		getWidthVersion: () => getWidthVersion?.() ?? 0,
		getViewportHeightVersion: () => getViewportHeightVersion?.() ?? 0,
		getParentPath: opts.getParentPath,
		reportSelfHeight: parentSink
			? (h) => parentSink.setChildSubtotal(opts.getIndex(), h)
			: undefined,
		isCollapsed: opts.isCollapsed,
		// Wide enough that a fast scroll rarely outruns the window recompute and paints an empty
		// spacer (VR-8), narrow enough to keep the count of mounted blocks low.
		overscan: 6,
		pinExtensionCap: 100,
		activateAbovePx: 4000,
		deactivateBelowPx: 3000
	});

	if (opts.provideLeafChannel) {
		// Only a direct child measures into this height table; a deeper block belongs to its own
		// list's channel, so registering here does nothing.
		setContext(RECORD_BLOCK_HEIGHT_KEY, {
			register(path, index, id, readHeight) {
				const depth = opts.getParentPath().length;
				if (path.length !== depth + 1) return () => {};
				return windowing.registerChild(id, {
					readHeight,
					applyHeight: (h) => windowing.recordMeasuredChild(index, id, h)
				});
			},
			measureNow: windowing.measureChildNow,
			measureOnResize: windowing.measureChildOnResize
		} satisfies BlockMeasureChannel);
	}
	setContext(PARENT_SCOPE_SINK_KEY, {
		setChildSubtotal: windowing.setChildSubtotal,
		registerRow: (id, readHeight, applyHeight) =>
			windowing.registerChild(id, { readHeight, applyHeight }),
		measureRowNow: windowing.measureChildNow
	} satisfies ParentScopeSink);

	return windowing;
}
