/**
 * The line ending a paste writes its own line breaks in. The clipboard reaches the paste
 * transforms and hooks as LF, and the document keeps one ending per line, so the pasted bytes
 * take the ending of the line the caret is on, read where they become the document's bytes.
 */

import type { CstNode, Document } from '../../core/nodes';
import { lineEndingAt, ownTrailingLineEnding } from '../../core/lines';
import type { InlinePasteResult } from '../paste-surfaces';

/**
 * The ending at the insertion point: the one closing the caret's line in the target, else the
 * nearest break in the top-level block holding it, else the one ending the block before that.
 * LF when the document holds no line break there at all.
 */
export function pasteLineEnding(
	doc: Document,
	targetPath: readonly number[],
	target: CstNode,
	offset: number
): '\n' | '\r\n' {
	const top = targetPath[0];
	return (
		lineEndingAt(target.raw, offset) ??
		lineEndingAt(doc.children[top]?.raw ?? '', 0) ??
		(ownTrailingLineEnding(doc.children[top - 1]?.raw ?? '') || '\n')
	);
}

/**
 * An inline hook's result with the line breaks it spliced in written as `ending`. Only the
 * bytes between the unchanged head and tail are the paste's, so a block holding an ending of
 * its own elsewhere keeps it; the caret moves with every break lengthened before it.
 */
export function inlineResultInEnding(
	before: string,
	result: InlinePasteResult,
	ending: '\n' | '\r\n'
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
