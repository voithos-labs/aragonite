/**
 * G1.61: a list move (Tab nesting an item, a lift out of a sublist, Backspace unwrapping a list's
 * first item) reads the same text in the same order before and after. Each move checks the region
 * it rewrites, the list that holds both ends of the move.
 */

import type { NodeView } from '../core/node-views';
import { assertInvariant, type InvariantViolation } from '../assert';
import { isDevChecks } from '../env';
import { leafTexts, sameTexts } from './leaf-text';

export function checkListMoveKeepsOrder(
	before: readonly string[],
	after: readonly string[]
): InvariantViolation | null {
	if (sameTexts(before, after)) return null;
	const at = before.findIndex((text, i) => text !== after[i]);
	const where = at === -1 ? before.length : at;
	return {
		code: 'list-move-keeps-order',
		message: `a list move changed the order its text reads in: leaf ${where} read "${before[where] ?? ''}" and now reads "${after[where] ?? ''}"`
	};
}

/** Runs `move`, and in a dev build checks that what `after` reads once it's done is the text
 *  `before` read, in the same order; by default both read the same region. */
export function keepingListOrder<T>(
	before: () => readonly NodeView[],
	move: () => T,
	after: (result: T) => readonly NodeView[] = () => before()
): T {
	const texts = isDevChecks() ? leafTexts(before()) : null;
	const result = move();
	if (texts) {
		assertInvariant('list-move-keeps-order', () =>
			checkListMoveKeepsOrder(texts, leafTexts(after(result)))
		);
	}
	return result;
}
