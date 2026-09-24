/**
 * What a block actually paints, read off the rendered DOM with marker subtrees skipped. The checks
 * that use it deliberately share the renderer, not `renderedText`, which the code under test calls
 * itself: a check sharing that would echo it instead of testing it. The marker families come from
 * the rule that defines them, so a private copy of the list cannot go stale.
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

/** Code-point boundaries only, for these checks rather than for the caret: they judge painted text
 *  and construct kinds, neither of which can see a slice through a single scalar, so a stop in the
 *  middle of a pair would pass anyway. The gesture fuzzer covers that class. */
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
