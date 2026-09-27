/** Where a paste cuts a leaf's displayed text, keeping the leaf's structural suffix on the head. */

import type { NodeView } from '../../core/node-views';
import { structuralSuffix } from '../../core/inline';
import { snapToScalarBoundary, trimTrailingLineEnding } from '../../core/lines';

/** `node`'s display cut at `offset`. Structure past the text (an ATX closing run, a setext
 *  underline) stays on the head, as a split keeps it, unless the cut sits at either edge. */
export function cutKeepingSuffix(node: NodeView, offset: number): { head: string; rest: string } {
	const display = trimTrailingLineEnding(node.raw);
	// The cut leaves a surrogate pair whole, since its halves would land in different blocks.
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
