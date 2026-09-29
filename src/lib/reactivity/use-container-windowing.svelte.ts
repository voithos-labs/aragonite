import { getContext, onDestroy, setContext, tick } from 'svelte';
import {
	CHILD_MEASURE_KEY,
	EDITOR_DOC_KEY,
	EDITOR_SERVICES_KEY,
	type ChildMeasureChannel,
	type EditorDoc,
	type EditorServices
} from '../editor-keys';
import type { NodeView } from '../core/node-views';
import type { RootListScroll } from '../cursor/scroll-owner';
import { observeResize } from '../cursor/observe-resize';
import { assertInvariant } from '../assert';
import { checkMeasuresInOwnList } from '../invariants/measures-in-own-list';
import {
	createListWindowing,
	type ListScrollWrites,
	type ListWindowing
} from './list-windowing.svelte';

export interface ContainerWindowingOpts {
	/** This list's path. */
	getParentPath: () => number[];
	getChildren: () => readonly NodeView[];
	getChildIds: () => string[];
	/** The element that scrolls with this list's children. Never the viewport. */
	getListEl: () => HTMLElement | null;
	/** True while collapsed; see `ListWindowingDeps.isCollapsed`. */
	isCollapsed?: () => boolean;
}

/** One windowing unit per nested container, whether it renders a `BlockList` or its own
 *  `{#each}`. Call synchronously during component init, since it reads and sets context. */
export function useContainerWindowing(opts: ContainerWindowingOpts): ListWindowing {
	return windowingUnit(opts);
}

/** The editor root's windowing, and the one height correction the header slot shares, which
 *  re-places a held target. Null without the editor's services, as in a harness. */
export function useRootWindowing(
	opts: Pick<ContainerWindowingOpts, 'getChildren' | 'getChildIds' | 'getListEl'>
): { windowing: ListWindowing; scroll: RootListScroll | null } {
	const scrollOwner = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.scrollOwner;
	const { listTree } = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const windowing = windowingUnit({ ...opts, getParentPath: () => [] });
	let scroll: RootListScroll | null = null;
	if (scrollOwner && listTree) {
		scroll = scrollOwner.resolveTargetsWith({
			resolve: listTree.resolve,
			holdForRound: listTree.holdForRound,
			syncScrollTop: () => windowing.syncScrollTop()
		});
		onDestroy(scroll.uninstall);
	}
	return { windowing, scroll };
}

function windowingUnit(opts: ContainerWindowingOpts): ListWindowing {
	const {
		heightOracle: oracle,
		scrollport: getPort,
		focusedPath: getFocusPath,
		widthVersion: getWidthVersion,
		viewportHeightVersion: getViewportHeightVersion,
		listTree
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const scrollOwner = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.scrollOwner;
	// A bare mount has no owner: its heights land, and nothing holds the page still.
	const scroll: ListScrollWrites = scrollOwner
		? {
				round: scrollOwner.round,
				measureSoon: scrollOwner.measureSoon,
				scrollToMount: scrollOwner.scrollToMount
			}
		: {
				round: (run) => run(),
				measureSoon: (run) => void tick().then(run),
				scrollToMount: () => {}
			};

	const windowing = createListWindowing({
		oracle,
		getChildren: opts.getChildren,
		getChildIds: opts.getChildIds,
		getListEl: opts.getListEl,
		getPort: () => getPort?.() ?? null,
		scroll,
		getFocusPath: () => getFocusPath?.() ?? null,
		getWidthVersion: () => getWidthVersion?.() ?? 0,
		getViewportHeightVersion: () => getViewportHeightVersion?.() ?? 0,
		getParentPath: opts.getParentPath,
		isCollapsed: opts.isCollapsed,
		// Wide enough that a fast scroll rarely outruns the window recompute and paints an empty
		// spacer (VR-8), narrow enough to keep the count of mounted blocks low.
		overscan: 6,
		pinExtensionCap: 100,
		activateAbovePx: 4000,
		deactivateBelowPx: 3000
	});
	if (listTree) onDestroy(listTree.add(windowing.level));

	// A child that isn't this list's own would write a slot that indexes something else.
	setContext(CHILD_MEASURE_KEY, {
		register(path, id, readHeight) {
			const foreign = checkMeasuresInOwnList(path, opts.getParentPath());
			if (foreign) {
				assertInvariant('measures-in-own-list', () => foreign);
				return () => {};
			}
			return windowing.registerChild(id, { index: path[path.length - 1], readHeight });
		},
		measureNow: windowing.measureChildNow,
		measureOnResize: windowing.measureChildOnResize,
		watchSize: scrollOwner
			? scrollOwner.watchSize
			: (el, onResize) => observeResize(el, (entries) => entries[0] && onResize(entries[0]))
	} satisfies ChildMeasureChannel);

	return windowing;
}
