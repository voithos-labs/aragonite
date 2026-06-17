import { getContext, setContext } from 'svelte';
import {
	EDITOR_ROOT_KEY,
	FOCUSED_PATH_KEY,
	HEIGHT_ORACLE_KEY,
	PARENT_SCOPE_SINK_KEY,
	RECORD_BLOCK_HEIGHT_KEY,
	type FocusedPathGetter,
	type ParentScopeSink,
	type RecordBlockHeight
} from '../editor-keys';
import type { HeightOracle } from '../cursor/height-oracle';
import type { CstNode } from '../core/nodes';
import { createListWindowing, type ListWindowing } from './list-windowing.svelte';

export interface ContainerWindowingOpts {
	/** Live read of this container's index in its PARENT scope, for the upward subtotal report. A getter (not a value) so reorders report under the current slot. Ignored at the root (no parent sink). */
	getIndex: () => number;
	/** This scope's path; the leaf-channel depth is its length. `[]` at the root. */
	getParentPath: () => number[];
	getChildren: () => CstNode[];
	getChildIds: () => string[];
	/** The content-origin element that scrolls WITH this scope's children (inner `.block-list` / `.list-block` / `.table-block`). Never the viewport. */
	getListEl: () => HTMLElement | null;
	/** The element the PARENT measures for this scope's height. Omit at the root (nothing measures it). */
	getOwnEl?: () => HTMLElement | null;
	/** True when this scope's DIRECT children are `BlockHost`s (editor / blockquote / list-item) → shadow the leaf channel. False for direct-`{#each}` scopes (list / table). */
	provideLeafChannel: boolean;
}

/**
 * One windowing wiring unit per BlockList-bearing OR direct-each container scope.
 * Reads the four VR contexts, builds `createListWindowing` with the shared
 * constants, and provides the subtotal sink (+ the leaf channel for hosted
 * children). Call it synchronously during component init. Returns the handle the
 * component passes to its sliced render and to `createContainerBlockComponent`.
 */
export function useContainerWindowing(opts: ContainerWindowingOpts): ListWindowing {
	const oracle = getContext<HeightOracle>(HEIGHT_ORACLE_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const getFocusPath = getContext<FocusedPathGetter | undefined>(FOCUSED_PATH_KEY);
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);

	const windowing = createListWindowing({
		oracle,
		getChildren: opts.getChildren,
		getChildIds: opts.getChildIds,
		getListEl: opts.getListEl,
		getOwnEl: opts.getOwnEl,
		getScrollEl: () => getEditorRoot?.() ?? null,
		getFocusPath: () => getFocusPath?.() ?? null,
		getParentPath: opts.getParentPath,
		reportSelfHeight: parentSink ? (h) => parentSink.setChildSubtotal(opts.getIndex(), h) : undefined,
		overscan: 4,
		pinExtensionCap: 100,
		activateAbovePx: 4000,
		deactivateBelowPx: 3000
	});

	if (opts.provideLeafChannel) {
		// A DIRECT child (path one deeper than this scope) measures into this model.
		setContext(RECORD_BLOCK_HEIGHT_KEY, ((path, id, h) => {
			const depth = opts.getParentPath().length;
			if (path.length === depth + 1) windowing.recordMeasuredChild(path[depth], id, h);
		}) satisfies RecordBlockHeight);
	}
	setContext(PARENT_SCOPE_SINK_KEY, {
		setChildSubtotal: windowing.setChildSubtotal
	} satisfies ParentScopeSink);

	return windowing;
}
