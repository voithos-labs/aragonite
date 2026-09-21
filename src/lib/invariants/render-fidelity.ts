/**
 * G1.28: the text a block renders still matches its raw bytes. A renderer that passes bytes
 * through an HTML parser inherits whatever that browser normalizes (U+0000, line endings,
 * surrogates), and a gesture that reads `textContent` back would commit the loss. jsdom preserves
 * all of them, so only this runtime check can catch it, never a unit test.
 */

import type { InvariantViolation } from '../assert';

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
		message: `rendered text diverges from the block's raw at index ${at}: the HTML parser normalized a byte the CST still holds`,
		detail: {
			at,
			renderedLength: rendered.length,
			expectedLength: expected.length,
			rendered: window(rendered),
			expected: window(expected)
		}
	};
}
