/** Builds the value every `updateBlockContent` returns: the write's promise, carrying its caret. */

import type { AdmittedContentWrite, ContentWrite } from '../action-contracts';

/** An admitted write. `storedOffset` defaults to the identity, right for a write no rule rewrites;
 *  `keepsCaret` is false when the write places the caret itself. */
export function withStoredCaret(
	done: Promise<boolean>,
	caret: number,
	storedOffset: (offset: number) => number = (offset) => offset,
	keepsCaret = true
): Promise<boolean> & AdmittedContentWrite {
	return Object.assign(done, { admitted: true as const, caret, storedOffset, keepsCaret });
}

/** A write the reading-mode check refused, or one with no block to write: no bytes, no caret. */
export function refusedWrite(): ContentWrite {
	return Object.assign(Promise.resolve(false), { admitted: false as const });
}
