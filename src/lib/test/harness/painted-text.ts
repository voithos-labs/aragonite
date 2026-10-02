/**
 * What a block actually paints, read off the rendered DOM with marker subtrees skipped. It shares
 * the renderer but not `renderedText`, which the code under test calls itself, so a check using it
 * tests that code rather than echoing it.
 */

import { parseInline } from '$lib/core/inline';
import { renderInlineNodes } from '$lib/core/inline-render';
import { MARKER_FAMILY_SELECTOR } from '$lib/core/inline/visibility';
import { renderOptions } from './fixture-grammar';

export function paintedText(raw: string): string {
	const fragment = renderInlineNodes(parseInline(raw, 0, raw.length), raw, renderOptions());
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

/** Code-point boundaries only: painted text and construct kinds cannot see a cut through a
 *  surrogate pair, which the gesture fuzzer covers. */
export function caretPositions(text: string): number[] {
	const stops = [0];
	for (const char of text) stops.push(stops[stops.length - 1] + char.length);
	return stops;
}

/** How many of `delimiters` survive onto the screen. Each suite passes its own set: which bytes
 *  count as a delimiter is that suite's claim about the code it tests, not a fact about rendering. */
export function countOnScreen(raw: string, delimiters: string): number {
	let count = 0;
	for (const char of paintedText(raw)) if (delimiters.includes(char)) count++;
	return count;
}
