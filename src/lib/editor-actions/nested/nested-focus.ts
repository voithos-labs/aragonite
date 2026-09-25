/**
 * A container's FocusActions. Delegates to the pure dispatcher in `focus-dispatch`,
 * supplying the container's live child count so an out-of-range move goes to the parent.
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import type { FocusPosition } from '../../block-component';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { dispatchMoveFocus } from '../focus/focus-dispatch';
import type { NestedActionsDeps } from './nested-actions';

export function createNestedFocus(state: BlockListState, deps: NestedActionsDeps): FocusActions {
	const { stickyColumn, parent } = deps;
	return {
		// Scrolling a nested block into view is the editor's recursive `revealPath` descending
		// through this container, so the container does not own it. The gap stop is forwarded
		// for the same reason: the root holds the document and selection reads.
		revealPath: parent.focus.revealPath,
		tryGapStop: parent.focus.tryGapStop,
		// Unlike the root `moveFocus`, never scrolls an unmounted child into view: the caller
		// keeps the target mounted (docs/design/virtual-rendering.md).
		async moveFocus(
			innerIndex: number,
			position: FocusPosition,
			options?: MoveFocusOptions
		): Promise<void> {
			await dispatchMoveFocus(
				state.innerBlockRefs,
				innerIndex,
				position,
				stickyColumn,
				{ focus: parent.focus, index: deps.index },
				{
					// node.children.length is the truth: refs.length lags after a structural edit
					// because bind:this fires asynchronously.
					childCount: deps.node.children?.length,
					options,
					// The boundaries this container owns are between its own children, so its
					// document-absolute path is their parent. Read live: `path` moves under edits.
					gapStop: (boundaryIndex) => parent.focus.tryGapStop(deps.path, boundaryIndex)
				}
			);
		}
	};
}
