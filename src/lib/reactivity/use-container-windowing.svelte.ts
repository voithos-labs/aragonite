import { getContext, setContext } from 'svelte';
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
import type { RevealTarget } from '../cursor/reveal-anchor';
import {
	createListWindowing,
	type ListWindowing,
	type RevealAnchorPlacement
} from './list-windowing.svelte';

export interface ContainerWindowingOpts {
	/** This container's index in the list above it, for the subtotal it reports upward. A
	 *  getter, so a reorder reports under the current index. Ignored at the root. */
	getIndex: () => number;
	/** This list's path; the depth of its leaf channel is its length. `[]` at the root. */
	getParentPath: () => number[];
	getChildren: () => readonly NodeView[];
	getChildIds: () => string[];
	/** The element that scrolls with this list's children. Never the viewport. */
	getListEl: () => HTMLElement | null;
	/** The element the parent measures for this list's height. Omit at the root. */
	getOwnEl?: () => HTMLElement | null;
	/** True when this list's direct children are `BlockHost`s, which means it provides the
	 *  leaf channel. False for a list that renders its children with `{#each}` (list, table). */
	provideLeafChannel: boolean;
	/** True while collapsed; see `ListWindowingDeps.isCollapsed`. */
	isCollapsed?: () => boolean;
}

/**
 * Put the block being scrolled into view into the root list's coordinates. The height table
 * addresses top-level children only, so a target further down contributes its ancestor's index
 * plus the measured drop to itself; without that, the hold re-asserts the container's top and
 * pushes a target already in place back out of view.
 */
export function placementOf(
	target: RevealTarget | null,
	blockEl: BlockElLookup
): RevealAnchorPlacement | null {
	if (!target || target.path.length === 0) return null;
	const shallow = { index: target.path[0], block: target.block, innerOffset: 0, height: null };
	if (target.path.length === 1) return shallow;
	const ancestorEl = blockEl([shallow.index]);
	const targetEl = blockEl(target.path);
	// The ancestor's top is a different block, and is only right while the ancestor itself is
	// unmounted and the height table's offset is all we know. A mounted ancestor whose target is
	// missing means the user scrolled past it inside the container: decline, never jump.
	if (!ancestorEl) return shallow;
	if (!targetEl) return null;
	const targetRect = targetEl.getBoundingClientRect();
	return {
		index: shallow.index,
		block: target.block,
		innerOffset: targetRect.top - ancestorEl.getBoundingClientRect().top,
		height: targetRect.height
	};
}

/**
 * One windowing unit per container, whether it renders a `BlockList` or its own `{#each}`:
 * reads the windowing contexts, builds `createListWindowing` with the shared constants, and
 * provides the subtotal callback and the leaf channel. Call synchronously during init.
 */
export function useContainerWindowing(opts: ContainerWindowingOpts): ListWindowing {
	const {
		heightOracle: oracle,
		scrollport: getPort,
		correctsScroll,
		focusedPath: getFocusPath,
		widthVersion: getWidthVersion,
		viewportHeightVersion: getViewportHeightVersion,
		blockElLookup
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);
	const revealAnchor = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.revealAnchor;
	// Only one list may do this: a nested list keeps holding the block at the top of the
	// viewport, or their corrections would fight over one `scrollTop`.
	const claimsRevealAnchor = opts.getParentPath().length === 0;

	const windowing = createListWindowing({
		oracle,
		getChildren: opts.getChildren,
		getChildIds: opts.getChildIds,
		getListEl: opts.getListEl,
		getOwnEl: opts.getOwnEl,
		getPort: () => getPort?.() ?? null,
		correctsScroll: () => correctsScroll?.() ?? true,
		getFocusPath: () => getFocusPath?.() ?? null,
		getRevealAnchorTarget: claimsRevealAnchor
			? () => placementOf(revealAnchor?.get() ?? null, blockElLookup)
			: undefined,
		getWidthVersion: () => getWidthVersion?.() ?? 0,
		getViewportHeightVersion: () => getViewportHeightVersion?.() ?? 0,
		getParentPath: opts.getParentPath,
		reportSelfHeight: parentSink
			? (h) => parentSink.setChildSubtotal(opts.getIndex(), h)
			: undefined,
		isCollapsed: opts.isCollapsed,
		// A fast scroll can outrun the deferred window recompute and briefly paint an empty
		// spacer (VR-8). 6 widens the band without breaking the ceiling on mounted blocks (the
		// e2e bound of under 60 checks that); a skeleton background covers the one-frame gap.
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
