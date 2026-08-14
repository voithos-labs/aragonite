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
	/** This container's index in its PARENT scope, for the upward subtotal report. A getter, so
	 *  reorders report under the current slot. Ignored at the root (no parent sink). */
	getIndex: () => number;
	/** This scope's path; the leaf-channel depth is its length. `[]` at the root. */
	getParentPath: () => number[];
	getChildren: () => readonly NodeView[];
	getChildIds: () => string[];
	/** The content-origin element that scrolls WITH this scope's children. Never the viewport. */
	getListEl: () => HTMLElement | null;
	/** The element the PARENT measures for this scope's height. Omit at the root. */
	getOwnEl?: () => HTMLElement | null;
	/** True when this scope's DIRECT children are `BlockHost`s → shadow the leaf channel.
	 *  False for direct-`{#each}` scopes (list / table). */
	provideLeafChannel: boolean;
	/** Collapse clamp; see `ListWindowingDeps.isCollapsed`. */
	isCollapsed?: () => boolean;
}

/**
 * Resolve the reveal target into the ROOT scope's coordinates. The model addresses
 * top-level children only, so a nested target contributes its ancestor's index plus the
 * measured drop down to itself — without which the pin re-asserts the CONTAINER's top and
 * pushes an already-resolved nested target back out of view.
 */
function placementOf(
	target: RevealTarget | null,
	blockEl: BlockElLookup
): RevealAnchorPlacement | null {
	if (!target || target.path.length === 0) return null;
	const shallow = { index: target.path[0], block: target.block, innerOffset: 0, height: null };
	if (target.path.length === 1) return shallow;
	const ancestorEl = blockEl([shallow.index]);
	const targetEl = blockEl(target.path);
	// An unmounted nested target has no geometry yet: hold the ancestor until it mounts.
	if (!ancestorEl || !targetEl) return shallow;
	const targetRect = targetEl.getBoundingClientRect();
	return {
		index: shallow.index,
		block: target.block,
		innerOffset: targetRect.top - ancestorEl.getBoundingClientRect().top,
		height: targetRect.height
	};
}

/**
 * One windowing wiring unit per BlockList-bearing or direct-each container scope: reads
 * the windowing contexts, builds `createListWindowing` with the shared constants, and
 * provides the subtotal sink plus the leaf channel. Call synchronously during component init.
 */
export function useContainerWindowing(opts: ContainerWindowingOpts): ListWindowing {
	const {
		heightOracle: oracle,
		scrollport: getPort,
		correctsScroll,
		focusedPath: getFocusPath,
		widthVersion: getWidthVersion,
		blockElLookup
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);
	const revealAnchor = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.revealAnchor;
	// Single-claimant: nested scopes keep top-of-viewport anchoring, or their deltas would
	// fight over one scrollTop.
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
		getParentPath: opts.getParentPath,
		reportSelfHeight: parentSink
			? (h) => parentSink.setChildSubtotal(opts.getIndex(), h)
			: undefined,
		isCollapsed: opts.isCollapsed,
		// A fling can outrun the deferred window recompute and briefly paint an empty spacer
		// (VR-8). 6 widens the band without breaching the mounted-set ceiling (the < 60 flat
		// e2e bound guards that); a skeleton background covers the residual one-frame gap.
		overscan: 6,
		pinExtensionCap: 100,
		activateAbovePx: 4000,
		deactivateBelowPx: 3000
	});

	if (opts.provideLeafChannel) {
		// Only a DIRECT child measures into this model; a deeper host belongs to its own
		// scope's channel, so register is a no-op here.
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
