/**
 * Runs a list move under the order check (G1.61): a dev build reads the region's leaf text before
 * and after the move and warns when the order changed. A production build only runs the move.
 */

import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import type { NodeView } from '../../core/node-views';
import { leafTextAround, leafTexts } from '../../invariants/leaf-text';
import { checkListMoveKeepsOrder } from '../../invariants/list-move-keeps-order';

/** Runs `move`, and in a dev build checks that the nodes `regionAfter` names read the text the
 *  nodes `region` named before it, in the same order; by default both name the same nodes. */
export function keepingListOrder<T>(
	region: () => readonly NodeView[],
	move: () => T,
	regionAfter: (result: T) => readonly NodeView[] = region
): T {
	const texts = devChecksOn ? leafTexts(region()) : null;
	const result = move();
	if (texts) {
		assertInvariant('list-move-keeps-order', () =>
			checkListMoveKeepsOrder(texts, leafTexts(regionAfter(result)))
		);
	}
	return result;
}

/** Runs a join over `nodes`, and in a dev build checks that the text before `from` and after `to`
 *  still opens and closes the region once it's done. */
export function keepingTextAround<T>(
	nodes: readonly NodeView[],
	from: NodeView | null,
	to: NodeView | null,
	join: () => T
): T {
	const around = devChecksOn ? leafTextAround(nodes, from, to) : null;
	const result = join();
	if (around) {
		assertInvariant('list-move-keeps-order', () => {
			const text = leafTexts(nodes).join('');
			const ends = [text.slice(0, around[0].length), text.slice(text.length - around[1].length)];
			return checkListMoveKeepsOrder(around, ends);
		});
	}
	return result;
}
