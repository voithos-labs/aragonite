/**
 * The production `BlockListState` for a container no component mounts, as the conformance kits
 * and the in-repo harness build it. `getNode` must read the live node: a commit replaces the
 * ancestor nodes, so a captured reference goes stale after the first commit.
 */

import type { BlockComponent } from '../block-component';
import type { CstNode } from '../core/nodes';
import { createBlockListState, type BlockListState } from '../reactivity/block-list-state.svelte';
import { replaceRefs } from '../reactivity/publish-ref.svelte';
import { stubBlockComponent } from './headless-actions';

export interface HeadlessBlockListOptions {
	/** The children's ids, written onto the node before the state reads them. */
	ids?: string[];
	/** The ref standing in for child `index`; `undefined` models a child outside the render
	 *  window. Defaults to a stub for every child, since no `$effect` fills refs headlessly. */
	refAt?: (index: number) => BlockComponent | undefined;
}

export function mountBlockListState(
	getNode: () => CstNode,
	options: HeadlessBlockListOptions = {}
): BlockListState {
	if (options.ids) getNode().childIds = [...options.ids];
	let state: BlockListState | undefined;
	// Its own effect root, since no component owns the state's effect. A server-compiled test
	// never runs the root's body, and has no effects to own.
	$effect.root(() => {
		state = createBlockListState(getNode);
	});
	state ??= createBlockListState(getNode);
	const refAt = options.refAt ?? (() => stubBlockComponent());
	replaceRefs(
		state.innerBlockRefs,
		state.innerBlockIds.map((_, i) => refAt(i))
	);
	return state;
}
