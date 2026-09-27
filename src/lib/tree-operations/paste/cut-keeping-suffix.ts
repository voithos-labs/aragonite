/** Where a paste cuts a leaf's displayed text, keeping the leaf's structural suffix on the head. */

import type { NodeView } from '../../core/node-views';
import { structuralSuffix } from '../../core/inline';
import { snapToScalarBoundary, trimTrailingLineEnding } from '../../core/lines';

/**
 * `node`'s display cut at `offset` into the text before and after. Structure past the text (a
 * heading's closing run, a setext underline) stays on the head, as a split keeps it, so it never
 * lands under a pasted block. A cut at the start or past the text keeps the suffix with the rest.
 */
export function cutKeepingSuffix(node: NodeView, offset: number): { head: string; rest: string } {
	const display = trimTrailingLineEnding(node.raw);
	// Off a surrogate pair's middle first: the halves land in different blocks.
	const cut = snapToScalarBoundary(display, offset);
	const suffix = structuralSuffix(node);
	const textEnd = display.length - suffix.length;
	if (suffix === '' || cut === 0 || cut > textEnd) {
		return { head: display.slice(0, cut), rest: display.slice(cut) };
	}
	// A suffix opening with a line break would double it after a cut just past one.
	return {
		head: trimTrailingLineEnding(display.slice(0, cut)) + suffix,
		rest: display.slice(cut, textEnd)
	};
}
