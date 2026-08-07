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
		// through this container, so this scope doesn't own it. The gap stop is forwarded
		// for the same reason: the root holds the doc and selection reads.
		revealPath: parent.focus.revealPath,
		tryGapStop: parent.focus.tryGapStop,
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
				options,
				// The boundaries this scope owns are its own children's, so the container's
				// doc-absolute path is their parent. Read live: `path` moves under edits.
				(boundaryIndex) => parent.focus.tryGapStop(deps.path, boundaryIndex)
			);
		}
	};
}
