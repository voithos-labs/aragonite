/**
 * The separator writes an edit makes by hand, outside the fix-up (`fix-up/apply.ts`): each copies
 * what it writes out of the undo snapshot and drops the owner's child spans first, since they
 * describe the bytes being rewritten.
 */

import { isBlankParagraph } from '../core/parser';
import { ownTrailingLineEnding } from '../core/lines';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { dropChildSpans } from '../schema/child-spans';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import type { BodyParent } from './node-primitives';

/**
 * The one separator write: the child copied out of the undo snapshot, then its line written. The
 * owner's child spans go first, since they describe the bytes being rewritten.
 */
function writeSeparator(
	body: BodyParent,
	index: number,
	trivia: string,
	sharing: SharingState
): void {
	retireChildSpans(body);
	ensureUnsharedChild(body, index, sharing).leadingTrivia = trivia;
}

/** Give the block at `index` a blank line where one separates anything; the line reuses the
 *  ending of the block above, which is the document's. */
function mintSeparator(body: BodyParent, index: number, sharing: SharingState): void {
	const { children } = body;
	if (index <= bodyStartIndex(body)) return;
	if (isBlankParagraph(children[index - 1])) return;
	writeSeparator(body, index, ownTrailingLineEnding(children[index - 1].raw), sharing);
}

/** A container's reserved title child is not a body block, so the body starts past it. */
function bodyStartIndex(body: BodyParent): number {
	const { owner } = body;
	return owner && tryGetBlockKindDescriptor(owner.kind)?.reservedChrome ? 1 : 0;
}

/** Every write to a body changes bytes the owner's child spans describe, so the spans are dropped
 *  and the next rebuild re-derives them. */
export function retireChildSpans(body: BodyParent): void {
	if (body.owner) dropChildSpans(body.owner);
}

/**
 * The separator a block takes back when it stops being blank: its own blank line was what stood
 * between it and a non-blank predecessor. Call when the block is filled.
 */
export function restoreSeparatorOnFill(
	body: BodyParent,
	index: number,
	sharing: SharingState
): void {
	const node = body.children[index];
	if (!node || node.leadingTrivia !== '' || isBlankParagraph(node)) return;
	mintSeparator(body, index, sharing);
}
