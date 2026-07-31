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
		// A nested scope's reveal IS the editor's recursive revealPath descending
		// through this container, so this scope doesn't own it.
		revealPath: parent.focus.revealPath,
		// Sync, and does not reveal an off-window inner target, unlike the root
		// `moveFocus`. The adjacent-only precondition is the caller's — VR-12
		// (docs/design/virtual-rendering.md).
		async moveFocus(
			innerIndex: number,
			position: FocusPosition,
			options?: MoveFocusOptions
		): Promise<void> {
			// node.children.length is authoritative: refs.length lags after structural
			// ops because bind:this fires asynchronously.
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
