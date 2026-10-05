/**
 * G1.58: Tab and Shift+Tab over a range move list items and shift code lines, and remove no text.
 * The check compares every leaf's bytes, whitespace aside, across the top-level blocks the range
 * spans, so a marker renumbered or a line indented passes and a lost word does not.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import type { InvariantViolation } from '../assert';

/** Each leaf's text less its whitespace, sorted, so a lifted item read in a new place still counts. */
export function leafText(doc: DocumentView, tops: readonly [number, number]): string[] {
	const texts: string[] = [];
	const walk = (node: NodeView) => {
		if (!node.children?.length) return void texts.push(node.raw.replace(/\s+/g, ''));
		node.children.forEach(walk);
	};
	for (let i = tops[0]; i <= tops[1]; i++) {
		const top = doc.children[i];
		if (top) walk(top);
	}
	return texts.sort();
}

export function checkIndentKeepsText(
	before: readonly string[],
	after: readonly string[]
): InvariantViolation | null {
	const same = before.length === after.length && before.every((text, i) => text === after[i]);
	return same
		? null
		: {
				code: 'range-indent-keeps-text',
				message: `an indent over a range changed the text it holds (${before.length} leaves before, ${after.length} after)`
			};
}
