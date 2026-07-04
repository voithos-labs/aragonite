/**
 * FocusActions factory for container nestedActions bundles. Delegates to the
 * pure dispatcher in `focus-dispatch`, supplying the container's live child
 * count so out-of-range delegation routes through the parent correctly.
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import type { FocusPosition } from '../../block-component';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { dispatchMoveFocus } from '../focus/focus-dispatch';
import type { NestedActionsDeps } from './nested-actions';

export function createNestedFocus(state: BlockListState, deps: NestedActionsDeps): FocusActions {
	const { stickyColumn, parent } = deps;
	return {
		// Bubble reveal to the parent: a nested scope's reveal is the editor's
		// recursive revealPath descending through this container, so this scope
		// doesn't own it. (Nested scopes do window, but moveFocus below doesn't
		// need to reveal; see its adjacent-only contract.)
		revealPath: parent.focus.revealPath,
		// `moveFocus` is sync and does not reveal an off-window inner target,
		// unlike the root `moveFocus` (which routes through `revealPath`). Every
		// caller steps by one from the focused caret (arrow navigation, widget
		// edge, unwrap-merge) and out-of-range delegates to the parent by one, so
		// the target is always within overscan of the pinned caret and therefore
		// mounted. A hypothetical >overscan inner jump would silently no-op — VR-12
		// (nested analog), latent and not currently reachable by any gesture.
		async moveFocus(
			innerIndex: number,
			position: FocusPosition,
			options?: MoveFocusOptions
		): Promise<void> {
			// node.children.length is authoritative: refs.length lags after
			// structural ops because bind:this fires asynchronously.
			await dispatchMoveFocus(
				state.innerBlockRefs,
				innerIndex,
				position,
				stickyColumn,
				{
					focus: parent.focus,
					index: deps.index
				},
				deps.node.children?.length,
				options
			);
		}
	};
}
