/**
 * G1.58: an indent key over a range moves list items and shifts code lines, and removes or reorders
 * no text. The check reads every leaf across the top-level blocks the range spans, in order.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import type { InvariantViolation } from '../assert';
import { leafTexts, sameTexts } from './leaf-text';

export function leafText(doc: DocumentView, tops: readonly [number, number]): string[] {
	const spanned: NodeView[] = doc.children.slice(tops[0], tops[1] + 1);
	return leafTexts(spanned);
}

export function checkIndentKeepsText(
	before: readonly string[],
	after: readonly string[]
): InvariantViolation | null {
	return sameTexts(before, after)
		? null
		: {
				code: 'range-indent-keeps-text',
				message: `an indent over a range changed the text it holds, or its order (${before.length} leaves before, ${after.length} after)`
			};
}
