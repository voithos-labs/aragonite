/**
 * The `createListWindowing` setup the windowing suites share: a stubbed scroll container, the
 * scroll owner writing it, a list element, an `$effect.root`, and the wiring every child list
 * takes. A suite passes only the fixture and the one option it tunes.
 */
import { flushSync } from 'svelte';
import {
	createListWindowing,
	type ListWindowing,
	type ListWindowingDeps
} from '../../reactivity/list-windowing.svelte';
import {
	placementOf,
	rootTargetResolver,
	type RootPlacement
} from '../../reactivity/use-container-windowing.svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import type { RootListScroll, ScrollOwner, ScrollOwnerDeps } from '../../cursor/scroll-owner';
import type { Scrollport } from '../../cursor/scrollport';
import type { CstNode } from '../../core/nodes';
import { stubListEl, stubScrollOwner, stubScrollport } from './stub-scrollport';

// ── Fixtures ────────────────────────────────────────────────────────────────

export const makePara = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

/** Every block the same height, whatever its id. */
export function fixedOracle(px: number): HeightOracle {
	return {
		estimate: () => px,
		measured: () => undefined,
		recordMeasured: () => {},
		dropMeasured: () => {}
	};
}

/** Heights keyed by id, so reordering the blocks changes each index's offset. The listed heights
 *  count as measured, which is what a block with a real box reports. */
export function heightsOracle(heights: Record<string, number>, estimate = 10): HeightOracle {
	return {
		estimate: () => estimate,
		measured: (id: string) => heights[id],
		recordMeasured: () => {},
		dropMeasured: () => {}
	};
}

/** Children and ids a suite can splice under a live list to drive a rebuild, for a suite that
 *  is not a `.svelte.ts` module and so can't declare `$state` itself. */
export function liveChildren(children: CstNode[], ids: string[]) {
	const reactiveChildren = $state(children);
	const reactiveIds = $state(ids);
	return { children: reactiveChildren, ids: reactiveIds };
}

// ── Mount ───────────────────────────────────────────────────────────────────

export type MountListWindowingOptions = Partial<ListWindowingDeps> & {
	/** Caller-owned so a suite can mutate it under a live scope; read only through the getter. */
	children: readonly CstNode[];
	ids: string[];
	oracle: HeightOracle;
	listHeight: number;
	viewportHeight?: number;
	viewportTop?: number;
	maxScrollTop?: number;
	snapsToPixel?: boolean;
	/** The space between the scroll container's content origin and this list's first block; a
	 *  getter when a suite grows a header above the list. */
	chromeAbove?: number | (() => number);
	/** The scroll owner's own deps: the editor correcting scroll and nothing mounted by default. */
	ownerDeps?: Partial<ScrollOwnerDeps>;
	/** Where a held path sits in this list, which stands in for the DOM measure the root list
	 *  makes; a top-level path's own index by default. */
	placeTargets?: (path: readonly number[]) => RootPlacement | null;
	/** Mount it as a nested list, correcting through the owner's plain correction; the resolver
	 *  still answers for a root list above it. */
	nested?: boolean;
};

export interface MountedListWindowing {
	windowing: ListWindowing;
	/** Writable, so a suite can stand in for the user scrolling. */
	port: Scrollport;
	owner: ScrollOwner;
	/** The root list's correction, which the header slot shares. */
	rootScroll: RootListScroll;
	cleanup: () => void;
}

export function mountListWindowing(options: MountListWindowingOptions): MountedListWindowing {
	const {
		children,
		ids,
		oracle,
		listHeight,
		viewportHeight = 500,
		viewportTop,
		maxScrollTop,
		snapsToPixel,
		chromeAbove,
		ownerDeps,
		placeTargets = (path) => placementOf(path, () => null),
		nested = false,
		...deps
	} = options;
	const port = stubScrollport({ viewportHeight, viewportTop, maxScrollTop, snapsToPixel });
	const owner = stubScrollOwner(port, ownerDeps);
	const listEl = stubListEl(port, listHeight, chromeAbove);

	let windowing!: ListWindowing;
	const cleanup = $effect.root(() => {
		windowing = createListWindowing({
			oracle,
			getChildren: () => children,
			getChildIds: () => ids,
			getListEl: () => listEl,
			getPort: () => port,
			scroll: {
				compensate: nested
					? owner.compensate
					: (mutate, held) => rootScroll.compensate(mutate, held),
				scrollToMount: owner.scrollToMount
			},
			getFocusPath: () => null,
			getWidthVersion: () => 0,
			getViewportHeightVersion: () => 0,
			getParentPath: () => [],
			overscan: 2,
			pinExtensionCap: 100,
			activateAbovePx: 1000,
			deactivateBelowPx: 800,
			...deps
		});
	});
	const rootScroll = owner.resolveTargetsWith(rootTargetResolver(windowing, placeTargets));
	flushSync();
	return { windowing, port, owner, rootScroll, cleanup };
}
