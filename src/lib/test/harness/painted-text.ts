/**
 * What a block actually paints, read off the rendered DOM with marker subtrees skipped. The oracles
 * that use it share the PAINTER deliberately, and not `renderedText`, which the seams under test
 * call themselves: an oracle sharing that check echoes it instead of contesting it. The FAMILIES
 * are the model's, though — a private list of them went stale on the ref label once.
 */

import { parseInline } from '$lib/core/inline';
import { renderInlineNodes } from '$lib/core/inline-render';
import { MARKER_FAMILY_SELECTOR } from '$lib/core/inline/visibility';

export function paintedText(raw: string): string {
	const fragment = renderInlineNodes(parseInline(raw, 0, raw.length), raw);
	const host = document.createElement('div');
	host.appendChild(fragment);
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	let out = '';
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (!node.parentElement?.closest(MARKER_FAMILY_SELECTOR)) out += node.textContent ?? '';
	}
	return out;
}

/** Code-point boundaries only, for an ORACLE's sake rather than the caret's: these nets judge
 *  painted text and construct kinds, neither of which can see a slice through a scalar, so a
 *  mid-pair stop would pass anyway. The gesture fuzzer's well-formedness oracle owns that class. */
export function caretPositions(text: string): number[] {
	const stops = [0];
	for (const char of text) stops.push(stops[stops.length - 1] + char.length);
	return stops;
}

/** How many of `delimiters` survive onto the screen. Each net passes its own set: which bytes count
 *  as a delimiter is that net's claim about its seam, not a fact about the painter. */
export function countOnScreen(raw: string, delimiters: string): number {
	let count = 0;
	for (const char of paintedText(raw)) if (delimiters.includes(char)) count++;
	return count;
}
