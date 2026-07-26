import { getContext, setContext } from 'svelte';
import {
	EDITOR_DOC_KEY,
	EDITOR_SERVICES_KEY,
	PARENT_SCOPE_SINK_KEY,
	RECORD_BLOCK_HEIGHT_KEY,
	type BlockMeasureChannel,
	type EditorDoc,
	type EditorServices,
	type ParentScopeSink
} from '../editor-keys';
import type { NodeView } from '../core/node-views';
import { createListWindowing, type ListWindowing } from './list-windowing.svelte';

export interface ContainerWindowingOpts {
	/** Live read of this container's index in its PARENT scope, for the upward subtotal report. A getter (not a value) so reorders report under the current slot. Ignored at the root (no parent sink). */
	getIndex: () => number;
	/** This scope's path; the leaf-channel depth is its length. `[]` at the root. */
	getParentPath: () => number[];
	getChildren: () => readonly NodeView[];
	getChildIds: () => string[];
	/** The content-origin element that scrolls WITH this scope's children (inner `.block-list` / `.list-block` / `.table-block`). Never the viewport. */
	getListEl: () => HTMLElement | null;
	/** The element the PARENT measures for this scope's height. Omit at the root (nothing measures it). */
	getOwnEl?: () => HTMLElement | null;
	/** True when this scope's DIRECT children are `BlockHost`s (editor / blockquote / list-item) → shadow the leaf channel. False for direct-`{#each}` scopes (list / table). */
	provideLeafChannel: boolean;
	/** Collapse clamp — while true this scope mounts only its chrome row (child 0). See `ListWindowingDeps.isCollapsed`. */
	isCollapsed?: () => boolean;
}

/**
 * One windowing wiring unit per BlockList-bearing OR direct-each container scope.
 * Reads the windowing contexts, builds `createListWindowing` with the shared
 * constants, and provides the subtotal sink (+ the leaf channel for hosted
 * children). Call it synchronously during component init. Returns the handle the
 * component passes to its sliced render and to `createContainerBlockComponent`.
 */
export function useContainerWindowing(opts: ContainerWindowingOpts): ListWindowing {
	const {
		heightOracle: oracle,
		editorRoot: getEditorRoot,
		focusedPath: getFocusPath,
		widthVersion: getWidthVersion,
		windowingEnabled
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);
	const revealAnchor = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.revealAnchor;
	// Single-claimant: only the ROOT scope holds the reveal anchor (path[0]); nested
	// scopes keep top-of-viewport anchoring, or their deltas would fight over one scrollTop.
	// Host-scroll mode has no claimant at all: the anchor's re-assertion writes scrollTop
	// on an element that doesn't scroll, and with windowing off nothing needs the pin.
	const claimsRevealAnchor = opts.getParentPath().length === 0 && windowingEnabled();

	const windowing = createListWindowing({
		oracle,
		getChildren: opts.getChildren,
		getChildIds: opts.getChildIds,
		getListEl: opts.getListEl,
		getOwnEl: opts.getOwnEl,
		getScrollEl: () => getEditorRoot?.() ?? null,
		getFocusPath: () => getFocusPath?.() ?? null,
		getRevealAnchorTarget: claimsRevealAnchor
			? () => {
					const target = revealAnchor?.get() ?? null;
					return target && target.path.length > 0
						? { index: target.path[0], block: target.block }
						: null;
				}
			: undefined,
		getWidthVersion: () => getWidthVersion?.() ?? 0,
		windowingEnabled,
		getParentPath: opts.getParentPath,
		reportSelfHeight: parentSink
			? (h) => parentSink.setChildSubtotal(opts.getIndex(), h)
			: undefined,
		isCollapsed: opts.isCollapsed,
		// A fling can outrun the deferred window recompute by more than the overscan
		// band, briefly painting an empty spacer (VR-8). 6 widens the band without
		// breaching the mounted-set ceiling (the < 60 flat e2e bound is the guard); a
		// skeleton spacer background covers the residual one-frame gap a compositor
		// fling can still open.
		overscan: 6,
		pinExtensionCap: 100,
		activateAbovePx: 4000,
		deactivateBelowPx: 3000
	});

	if (opts.provideLeafChannel) {
		// A DIRECT child (path one deeper than this scope) measures into this model via
		// the scope's batched pass. Nested hosts (path deeper than this scope) belong to
		// their own scope's channel, so register is a no-op here.
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
