/**
 * G1.28 — rendered text fidelity. A block renderer that round-trips its bytes
 * through an HTML parser (`template.innerHTML`) inherits that parser's
 * normalizations, which are outside this project's control and differ between
 * engines: the HTML tree-construction algorithm drops U+0000 outright, and
 * line-ending and surrogate handling is engine-defined. jsdom (parse5) preserves
 * all of them, so a unit suite cannot see a loss that a browser would produce.
 *
 * The code block reads `el.textContent` back on Tab-indent, dedent, and cut, so a
 * character the parser ate would be committed away on the next such gesture —
 * byte loss on a byte the user pasted. This predicate is the runtime belt that
 * fires in the browser the day an engine normalizes something.
 */

import type { InvariantViolation } from './assert';

/** First index at which the strings differ, or -1. */
function firstDivergence(rendered: string, expected: string): number {
	const shortest = Math.min(rendered.length, expected.length);
	for (let i = 0; i < shortest; i++) {
		if (rendered[i] !== expected[i]) return i;
	}
	return rendered.length === expected.length ? -1 : shortest;
}

export function checkRenderedTextFidelity(
	rendered: string,
	expected: string
): InvariantViolation | null {
	const at = firstDivergence(rendered, expected);
	if (at === -1) return null;
	const context = 12;
	const window = (text: string) => text.slice(Math.max(0, at - context), at + context);
	return {
		code: 'rendered-text-fidelity',
		message: `rendered text diverges from the block's raw at index ${at} — the HTML parser normalized a byte the CST still holds`,
		detail: {
			at,
			renderedLength: rendered.length,
			expectedLength: expected.length,
			rendered: window(rendered),
			expected: window(expected)
		}
	};
}
