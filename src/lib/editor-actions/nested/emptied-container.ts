import type { RemovalGesture } from '../../selection/caret-target';
import type { NestedActionsDeps } from './nested-actions';

/** Removes the container from its parent's list, for an edit that would take its last child: an
 *  emptied container goes rather than stay childless. */
export function removeEmptiedContainer(
	deps: NestedActionsDeps,
	gesture: RemovalGesture
): Promise<boolean> {
	return deps.parent.blockEdit.deleteBlock(deps.index, gesture);
}
