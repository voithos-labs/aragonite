/**
 * G1.61: a list move (Tab nesting an item, a lift out of a sublist, Backspace unwrapping a list's
 * first item or merging a middle one) reads the same text in the same order before and after. Each
 * move reads the list it rewrites; a merge reads around the two lines its join rewrites.
 */

import { assertInvariant, type InvariantViolation } from '../assert';
import { isDevChecks } from '../env';
import { sameTexts } from './leaf-text';

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
 *  `before` read, in the same order; by default both read the same way. */
export function keepingListOrder<T>(
	before: () => readonly string[],
	move: () => T,
	after: (result: T) => readonly string[] = () => before()
): T {
	const texts = isDevChecks() ? before() : null;
	const result = move();
	if (texts) {
		assertInvariant('list-move-keeps-order', () => checkListMoveKeepsOrder(texts, after(result)));
	}
	return result;
}
