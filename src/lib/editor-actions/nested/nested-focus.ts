/**
 * A container's FocusActions: the one traversal in `focus-dispatch` over the container's own
 * child list, handing a move off either end to the parent.
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import type { FocusPosition } from '../../block-component';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { descendTo, type ChildList } from '../../reactivity/child-list';
import { delegateMoveFocus, dispatchMoveFocus, type MoveFocusScope } from '../focus/focus-dispatch';
import type { NestedActionsDeps } from './nested-actions';

export function createNestedFocus(state: BlockListState, deps: NestedActionsDeps): FocusActions {
	const { caretMemory, parent } = deps;
	const children = (): ChildList => deps.childList?.() ?? mountedOnly(state, deps);
	const scope: MoveFocusScope = {
		// The tree's count, not the refs': those lag a structural edit by a render.
		count: () => deps.node.children?.length ?? 0,
		mount: (index) => descendTo(children(), [index]),
		leave: async (step, position, options) => {
			await delegateMoveFocus(parent.focus, deps.index + step, position, options);
		},
		// The boundaries this container owns are between its own children, so its
		// document-absolute path is their parent. Read live: `path` moves under edits.
		gapStop: (boundaryIndex) => parent.focus.tryGapStop(deps.path, boundaryIndex),
		arrived: (index) => parent.focus.followArrival([...deps.path, index])
	};
	return {
		// The root holds the document, the selection reads and the scroll, so both are forwarded.
		tryGapStop: parent.focus.tryGapStop,
		followArrival: parent.focus.followArrival,
		async moveFocus(
			innerIndex: number,
			position: FocusPosition,
			options?: MoveFocusOptions
		): Promise<void> {
			await dispatchMoveFocus(scope, innerIndex, position, caretMemory, options);
		}
	};
}

/** A list with no render window, for a suite with no components: nothing mounts later, so an
 *  empty ref is out of range. */
function mountedOnly(state: BlockListState, deps: NestedActionsDeps): ChildList {
	return {
		count: () => deps.node.children?.length ?? 0,
		refs: state.refSlots,
		windowing: {
			revealChild: async () => {},
			isInWindow: (index) => state.refSlots.get(index) !== undefined
		}
	};
}
