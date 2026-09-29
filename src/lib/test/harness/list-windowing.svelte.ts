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
import { createListTree, type ListTree } from '../../reactivity/list-tree';
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
};

export interface MountedListWindowing {
	windowing: ListWindowing;
	/** Writable, so a suite can stand in for the user scrolling. */
	port: Scrollport;
	owner: ScrollOwner;
	/** The root list's correction, which the header slot shares. */
	rootScroll: RootListScroll;
	/** Every list mounted over this root, which a nested list joins. */
	tree: ListTree;
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
		...deps
	} = options;
	const port = stubScrollport({ viewportHeight, viewportTop, maxScrollTop, snapsToPixel });
	const owner = stubScrollOwner(port, ownerDeps);
	const listEl = stubListEl(port, listHeight, chromeAbove);

	const getFocusPath = deps.getFocusPath ?? (() => null);
	const tree = createListTree({ getScrollTop: () => port.scrollTop(), getFocusPath });
	let windowing!: ListWindowing;
	const cleanup = $effect.root(() => {
		windowing = createListWindowing({
			oracle,
			getChildren: () => children,
			getChildIds: () => ids,
			getListEl: () => listEl,
			getPort: () => port,
			scroll: ownerWrites(owner),
			getFocusPath,
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
	tree.add(windowing.level);
	const rootScroll = owner.resolveTargetsWith({
		resolve: tree.resolve,
		holdForRound: tree.holdForRound,
		syncScrollTop: () => windowing.syncScrollTop()
	});
	flushSync();
	return { windowing, port, owner, rootScroll, tree, cleanup };
}

function ownerWrites(owner: ScrollOwner): ListWindowingDeps['scroll'] {
	return {
		round: owner.round,
		measureSoon: owner.measureSoon,
		scrollToMount: owner.scrollToMount
	};
}

export interface NestedListOptions {
	root: MountedListWindowing;
	/** The root child this list renders inside. */
	at: number;
	children: readonly CstNode[];
	ids: string[];
	oracle: HeightOracle;
	listHeight: number;
	/** The space between the child's own top and this list's first block. */
	chromeAbove?: number;
	getFocusPath?: () => number[] | null;
}

/** A list nested in the root's child `at`, placed where the root's height table puts that child,
 *  and joined to the root's tree. */
export function mountNestedList(options: NestedListOptions): {
	windowing: ListWindowing;
	cleanup: () => void;
} {
	const { root, at, children, ids, oracle, listHeight, chromeAbove = 0 } = options;
	const childTop = () => root.windowing.targetTopOf(at)?.top ?? 0;
	const onScreen = (contentTop: number) =>
		root.port.viewportTop() + contentTop - root.port.scrollTop();
	const box = { getBoundingClientRect: () => ({ top: onScreen(childTop()) }) };
	const listEl = {
		clientWidth: 800,
		closest: () => box,
		getBoundingClientRect: () => ({ top: onScreen(childTop() + chromeAbove), height: listHeight })
	} as unknown as HTMLElement;
	let windowing!: ListWindowing;
	const cleanup = $effect.root(() => {
		windowing = createListWindowing({
			oracle,
			getChildren: () => children,
			getChildIds: () => ids,
			getListEl: () => listEl,
			getPort: () => root.port,
			scroll: ownerWrites(root.owner),
			getFocusPath: options.getFocusPath ?? (() => null),
			getWidthVersion: () => 0,
			getViewportHeightVersion: () => 0,
			getParentPath: () => [at],
			overscan: 2,
			pinExtensionCap: 100,
			activateAbovePx: 1000,
			deactivateBelowPx: 800
		});
	});
	const remove = root.tree.add(windowing.level);
	flushSync();
	return {
		windowing,
		cleanup: () => {
			remove();
			cleanup();
		}
	};
}
