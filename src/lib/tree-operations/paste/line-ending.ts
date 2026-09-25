/**
 * The pasted line breaks written in the document's own ending. The clipboard reaches the paste
 * transforms and hooks as LF, so an inline hook's result is rewritten here on its way in.
 */

import type { LineEnding } from '../../core/lines';
import type { InlinePasteResult } from '../paste-surfaces';

/**
 * An inline hook's result with the line breaks it spliced in written as `ending`. Only the
 * bytes between the unchanged head and tail are the paste's, so a block holding an ending of
 * its own elsewhere keeps it; the caret moves with every break lengthened before it.
 */
export function inlineResultInEnding(
	before: string,
	result: InlinePasteResult,
	ending: LineEnding
): InlinePasteResult {
	if (ending === '\n') return result;
	const after = result.newRaw;
	let head = 0;
	while (head < before.length && before[head] === after[head]) head++;
	let tail = 0;
	while (
		tail < before.length - head &&
		tail < after.length - head &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	) {
		tail++;
	}
	const end = after.length - tail;
	let lengthened = 0;
	const newRaw = after.replace(/(?<!\r)\n/g, (lf, at: number) => {
		if (at < head || at >= end) return lf;
		if (at < result.caretOffset) lengthened++;
		return ending;
	});
	return { newRaw, caretOffset: result.caretOffset + lengthened };
}
