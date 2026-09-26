/** Builds the value every `updateBlockContent` returns: the write's promise, carrying its caret. */

import type { ContentWrite } from '../action-contracts';

export function withStoredCaret(done: Promise<void>, caret: number): ContentWrite {
	return Object.assign(done, { caret });
}
