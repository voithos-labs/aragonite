/** Builds the value every `updateBlockContent` returns: the write's promise, carrying its caret. */

import type { ContentWrite } from '../action-contracts';

/** `storedOffset` defaults to the identity, right for a write no rule rewrites. */
export function withStoredCaret(
	done: Promise<void>,
	caret: number,
	storedOffset: (offset: number) => number = (offset) => offset
): ContentWrite {
	return Object.assign(done, { caret, storedOffset });
}
